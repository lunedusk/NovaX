import { timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Router, type Request, type Response, type NextFunction } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { permissionsManager } from '#core/manager/permissions.js';

const log = getLogger('GatewayConfigManager');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CorsConfig {
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    credentials: boolean;
    maxAge: number;
}

export interface AuthKeyEntry {
    key: string;
    label: string;
    enabled: boolean;
    bits?: string[];
}

export interface AuthConfig {
    enabled: boolean;
    masterKeySource: 'env' | 'config';
    masterKeyEnvVar: string;
    publicPaths: string[];
    keys: AuthKeyEntry[];
}

export interface GatewayPluginConfig {
    publicBaseUrl?: string;
    cors: CorsConfig;
    auth: AuthConfig;
}

interface GatewayAuthContext {
    isMaster: boolean;
    label: string;
    bits: string[];
}

// ─── GatewayConfigManager ───────────────────────────────────────────────────

export class GatewayConfigManager {
    private static _instance: GatewayConfigManager;
    private _config!: Readonly<GatewayPluginConfig>;
    private _cachedSpec: Record<string, unknown> | null = null;

    private constructor() {}

    public static get instance(): GatewayConfigManager {
        if (!this._instance) this._instance = new GatewayConfigManager();
        return this._instance;
    }

    public init(config: Readonly<GatewayPluginConfig>): void {
        this._config = config;
        if (this._config.auth.enabled && this._config.auth.masterKeySource === 'env') {
            const masterKey = secrets.getOptional(this._config.auth.masterKeyEnvVar);
            if (!masterKey) {
                throw new Error(`Gateway master key is missing. Set ${this._config.auth.masterKeyEnvVar} before starting.`);
            }
        }

        log.info('Gateway config loaded from framework ConfigManager.');
    }

    // ─── Config accessors ────────────────────────────────────────────────────

    public get cors(): Readonly<CorsConfig> { return this._config.cors; }
    public get auth(): Readonly<AuthConfig> { return this._config.auth; }
    public get publicBaseUrl(): string {
        const configured = this._config.publicBaseUrl?.trim();
        if (configured) return configured.replace(/\/$/, '');

        const port = secrets.getOptional('APIPort', '3000') ?? '3000';
        const normalizedPort = String(port).trim() || '3000';
        const fallback = `http://localhost:${normalizedPort}`;

        log.warn(`Gateway publicBaseUrl is not configured. Falling back to ${fallback}.`);
        return fallback;
    }

    // ─── Middleware stack ─────────────────────────────────────────────────────

    public applyMiddleware(router: Router): void {
        router.use(this.securityHeaders);
        router.use(this.corsHandler);
        router.use(this.bearerAuth);
        router.use(this.routeAuthorization);
    }

    private securityHeaders(_req: Request, res: Response, next: NextFunction): void {
        res.removeHeader('X-Powered-By');
        res.removeHeader('Server');

        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '0');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

        next();
    }

    private corsHandler = (req: Request, res: Response, next: NextFunction): void => {
        const cfg = this._config.cors;
        const origin = req.headers['origin'];

        if (origin && this.isOriginAllowed(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            if (cfg.credentials) {
                res.setHeader('Access-Control-Allow-Credentials', 'true');
            }
        }

        res.setHeader('Access-Control-Allow-Methods', cfg.allowedMethods.join(', '));
        res.setHeader('Access-Control-Allow-Headers', cfg.allowedHeaders.join(', '));

        if (cfg.exposedHeaders.length > 0) {
            res.setHeader('Access-Control-Expose-Headers', cfg.exposedHeaders.join(', '));
        }

        res.setHeader('Access-Control-Max-Age', String(cfg.maxAge));
        res.setHeader('Vary', 'Origin');

        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }

        next();
    };

    private bearerAuth = (req: Request, res: Response, next: NextFunction): void => {
        const cfg = this._config.auth;

        if (!cfg.enabled) { next(); return; }

        const fullPath = req.baseUrl + req.path;
        if (cfg.publicPaths.some((prefix) => fullPath.startsWith(prefix))) { next(); return; }

        const authHeader = req.headers['authorization'] as string | undefined;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Unauthorized', message: 'Missing or malformed Authorization header. Expected: Bearer <token>' });
            return;
        }

        const authContext = this.resolveAuthContext(authHeader.slice(7));
        if (!authContext) {
            res.status(403).json({ error: 'Forbidden', message: 'Invalid or revoked API key.' });
            return;
        }

        res.locals.gatewayAuth = authContext;

        next();
    };

    private routeAuthorization = (req: Request, res: Response, next: NextFunction): void => {
        if (!this._config.auth.enabled) {
            next();
            return;
        }

        const fullPath = req.baseUrl + req.path;
        const isSensitiveRoute = fullPath.startsWith('/api/tokens')
            || fullPath.startsWith('/api/permissions')
            || fullPath === '/api/health';

        if (this._config.auth.publicPaths.some((prefix) => fullPath.startsWith(prefix))) {
            next();
            return;
        }

        if (!permissionsManager) {
            if (isSensitiveRoute) {
                res.status(503).json({ error: 'Gateway Unavailable', message: 'Permission policy service is not initialized.' });
                return;
            }

            next();
            return;
        }

        const policy = permissionsManager.resolveHttpRouteAccess(req.method, fullPath);
        if (!policy) {
            if (isSensitiveRoute) {
                res.status(500).json({ error: 'Misconfigured Route Policy', message: `No permission policy is defined for ${req.method} ${fullPath}.` });
                return;
            }

            next();
            return;
        }

        if (policy.public) {
            next();
            return;
        }

        const requiredBits = policy.bits ?? [];
        if (requiredBits.length === 0) {
            res.status(500).json({ error: 'Misconfigured Route Policy', message: `Route policy for ${req.method} ${fullPath} has no permission bits configured.` });
            return;
        }

        const auth = res.locals.gatewayAuth as GatewayAuthContext | undefined;
        if (!auth) {
            res.status(403).json({ error: 'Forbidden', message: policy.denyMessage ?? 'This route requires API authentication.' });
            return;
        }

        if (auth.isMaster) {
            next();
            return;
        }

        const hasAllBits = requiredBits.every((bit) => auth.bits.includes(bit));
        if (!hasAllBits) {
            res.status(403).json({ error: 'Forbidden', message: policy.denyMessage ?? 'Missing required API route permission.' });
            return;
        }

        next();
    };


    public buildOpenApiSpec(): Record<string, unknown> {
        if (!this._cachedSpec) {
            this._cachedSpec = swaggerJsdoc({
                definition: {
                    openapi: '3.1.0',
                    info: {
                        title:       'NovaX API Gateway',
                        version:     '0.0.1',
                        description: 'API Gateway for the NovaX Framework.',
                        contact: { name: 'Lunedusk' },
                        license: { name: 'Proprietary' },
                    },
                    tags: [
                        { name: 'Bot Api',  description: 'Discord Bot Internal API Endpoints' }
                    ],
                    components: {
                        securitySchemes: {
                            bearerAuth: { type: 'http', scheme: 'bearer' },
                        },
                        schemas: {
                            Error: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
                        },
                        responses: {
                            Unauthorized: { description: 'Missing or malformed Authorization header', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                            Forbidden:    { description: 'Invalid or revoked API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                        },
                    },
                    security: [{ bearerAuth: [] }],
                    paths: {
                        '/api/health': {
                            get: {
                                tags: ['System'], summary: 'Health check', operationId: 'getHealth',
                                responses: {
                                    '200': { description: 'Server is healthy', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'online' }, uptime: { type: 'number', example: 3600 } } } } } },
                                    '401': { $ref: '#/components/responses/Unauthorized' },
                                    '403': { $ref: '#/components/responses/Forbidden' },
                                },
                                security: [{ bearerAuth: [] }],
                            },
                        },
                    },
                },
                apis: [
                    path.join(__dirname, '..', 'routes', '*.ts'),
                    path.join(__dirname, '..', 'routes', '*.js'),
                ],
            }) as Record<string, unknown>;
        }

        return { ...this._cachedSpec, servers: [{ url: this._config.publicBaseUrl, description: 'Canonical public API base URL' }] };
    }


    public isOriginAllowed(origin: string): boolean {
        return this._config.cors.allowedOrigins.some(pattern => {
            if (pattern === '*') return true;
            const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
            if (regexMatch) return new RegExp(regexMatch[1], regexMatch[2]).test(origin);
            return pattern === origin;
        });
    }


    public isValidKey(key: string): boolean {
        return !!this.resolveAuthContext(key);
    }

    public resolveAuthContext(key: string): GatewayAuthContext | null {
        if (this._config.auth.enabled && this._config.auth.masterKeySource === 'env') {
            const masterKey = secrets.getOptional(this._config.auth.masterKeyEnvVar);
            if (masterKey && this.safeEquals(key, masterKey)) {
                return { isMaster: true, label: 'env-master', bits: [] };
            }
        }

        const matchedKey = this._config.auth.keys.find((entry) => entry.enabled && this.safeEquals(key, entry.key));
        if (!matchedKey) return null;

        return {
            isMaster: false,
            label: matchedKey.label,
            bits: Array.isArray(matchedKey.bits) ? matchedKey.bits : [],
        };
    }

    private safeEquals(a: string, b: string): boolean {
        const hashA = createHash('sha256').update(a).digest();
        const hashB = createHash('sha256').update(b).digest();
        return timingSafeEqual(hashA, hashB);
    }
}
