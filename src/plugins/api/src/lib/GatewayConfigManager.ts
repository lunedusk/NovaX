import { timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Router, type Request, type Response, type NextFunction } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import { getLogger } from '#core/utils/logger.js';

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
}

export interface AuthConfig {
    enabled: boolean;
    publicPaths: string[];
    keys: AuthKeyEntry[];
}

export interface GatewayPluginConfig {
    cors: CorsConfig;
    auth: AuthConfig;
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
        log.info('Gateway config loaded from framework ConfigManager.');
    }

    // ─── Config accessors ────────────────────────────────────────────────────

    public get cors(): Readonly<CorsConfig> { return this._config.cors; }
    public get auth(): Readonly<AuthConfig> { return this._config.auth; }

    // ─── Middleware stack ─────────────────────────────────────────────────────

    public applyMiddleware(router: Router): void {
        router.use(this.securityHeaders);
        router.use(this.corsHandler);
        router.use(this.bearerAuth);
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

        if (!this.isValidKey(authHeader.slice(7))) {
            res.status(403).json({ error: 'Forbidden', message: 'Invalid or revoked API key.' });
            return;
        }

        next();
    };


    public buildOpenApiSpec(baseUrl: string): Record<string, unknown> {
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
                                tags: ['System'], summary: 'Health check', operationId: 'getHealth', security: [],
                                responses: { '200': { description: 'Server is healthy', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'online' }, uptime: { type: 'number', example: 3600 } } } } } } },
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

        return { ...this._cachedSpec, servers: [{ url: baseUrl, description: 'Current server' }] };
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
        return this._config.auth.keys.some(k => k.enabled && this.safeEquals(key, k.key));
    }

    private safeEquals(a: string, b: string): boolean {
        const hashA = createHash('sha256').update(a).digest();
        const hashB = createHash('sha256').update(b).digest();
        return timingSafeEqual(hashA, hashB);
    }
}
