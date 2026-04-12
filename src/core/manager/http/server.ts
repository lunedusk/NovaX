import express, { type Express, type Router, type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import cors from 'cors';
import { getLogger } from '#core/utils/logger.js';
import { performance } from 'node:perf_hooks';
import { secrets } from '#core/helpers/secretManager.js';

const log = getLogger('HttpServer');

export class HttpServer {
    private app: Express | null = null;
    private server: http.Server | null = null;
    private isRunning = false;

    public init(): void {
        if (this.app) {
            log.warn('HttpServer is already initialized. Skipping.');
            return;
        }

        log.info('Initializing REST API Server...');
        this.app = express();

        this.app.use(cors());
        this.app.use(express.json({ limit: '500kb' })); 
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

        this.app.get('/api/health', (req: Request, res: Response) => {
            res.status(200).json({ 
                status: 'online', 
                uptime: process.uptime(), 
                timestamp: Date.now() 
            });
        });
    }

    public registerRouter(basePath: string, router: Router): void {
        if (!this.app) throw new Error("HttpServer must be initialized before registering routes.");
        this.app.use(basePath, router);
        log.debug(`Registered API Route: ${basePath}`);
    }

    public async start(port: number = parseInt(secrets.getOptional('APIPort') || '3000')): Promise<void> {
        if (!this.app) throw new Error("HttpServer must be initialized before starting.");
        if (this.isRunning) return;

        return new Promise((resolve, reject) => {
            this.app!.use((req: Request, res: Response) => {
                res.status(404).json({ error: 'Endpoint Not Found' });
            });

            this.app!.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
                const cleanUrl = req.originalUrl.split('?')[0];
                log.error(`API Error [${req.method} ${cleanUrl}]: ${err.message}`, { stack: err.stack });
                
                res.status(500).json({ error: 'Internal Server Error' });
            });

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

    public async stop(): Promise<void> {
        if (!this.server || !this.isRunning) return;

        return new Promise((resolve) => {
            log.info('Initiating REST API shutdown...');

            if ('closeAllConnections' in this.server!) {
                this.server.closeAllConnections();
            }

            this.server!.close((err) => {
                this.isRunning = false;
                this.server = null;
                
                if (err) {
                    log.error(`Error during REST API shutdown: ${err.message}`);
                } else {
                    log.info('REST API gracefully shut down.');
                }
                resolve();
            });
        });
    }
}

export const httpServer = new HttpServer();