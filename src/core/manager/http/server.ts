import express, { type Express, type Router, type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import { getLogger } from '#core/utils/logger.js';
import { performance } from 'node:perf_hooks';
import { secrets } from '#core/helpers/secretManager.js';

const log = getLogger('HttpServer');

export class HttpServer {
    private app: Express | null = null;
    private server: http.Server | null = null;
    private isRunning = false;

    public init(): void {
        if (this.app) return;

        log.info('Initializing REST API Server...');
        this.app = express();
        
        this.app.use(express.json({ 
            limit: '500kb',
            verify: (req: any, _res, buf) => { req.rawBody = buf; } 
        })); 
        this.app.use(express.urlencoded({ extended: true, limit: '500kb' }));

        this.app.use((req: Request, res: Response, next: NextFunction) => {
            const start = performance.now();
            res.on('finish', () => {
                const duration = performance.now() - start;
                const status = res.statusCode;
                const cleanUrl = req.originalUrl.split('?')[0];
                const msg = `[${req.method}] ${cleanUrl} - ${status} (${duration.toFixed(2)}ms)`;
                
                if (status >= 500) log.error(msg);
                else if (status >= 400) log.warn(msg);
                else log.debug(msg);
            });
            next();
        });

        this.app.get('/health', (_req: Request, res: Response) => {
            res.status(200).json({ ok: true });
        });
    }

    public registerRouter(basePath: string, router: Router): void {
        if (!this.app) throw new Error("HttpServer not initialized.");
        
        this.unregisterRouter(basePath);

        this.app.use(basePath, router);
        const stack = (this.app as any)._router?.stack;
        if (stack && stack.length > 0) {
            stack[stack.length - 1].__novaxBasePath = basePath;
        }

        log.debug(`Mounted Router: ${basePath}`);
    }

    public unregisterRouter(basePath: string): void {
        if (!this.app || !(this.app as any)._router) return;

        const stack = (this.app as any)._router.stack;
        if (!stack) return;

        let removedCount = 0;
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].__novaxBasePath === basePath) {
                stack.splice(i, 1);
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            log.debug(`Unmounted API Router: ${basePath}`);
        }
    }

    public async start(port: number = parseInt(secrets.getOptional('APIPort') || '3000')): Promise<void> {
        if (this.isRunning) return;

        return new Promise((resolve, reject) => {
            try {
                this.server = this.app!.listen(port, () => {
                    this.isRunning = true;
                    log.info(`REST API active on http://localhost:${port}`);
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    public finalize(): void {
        if (!this.app) return;

        this.app.use((req: Request, res: Response) => {
            res.status(404).json({ 
                error: 'Not Found', 
                message: `Route ${req.method} ${req.originalUrl} does not exist.` 
            });
        });

        this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
            log.error(`API Exception: ${err.message}`, { stack: err.stack });
            res.status(500).json({ error: 'Internal Server Error' });
        });

        log.info('HttpServer pipeline finalized and locked.');
    }

    public async stop(): Promise<void> {
        if (!this.server) return;
        return new Promise((resolve) => {
            this.server!.close(() => {
                this.isRunning = false;
                log.info('REST API shut down.');
                resolve();
            });
        });
    }
}

export const httpServer = new HttpServer();