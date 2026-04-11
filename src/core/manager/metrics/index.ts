import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { Router, Request, Response } from 'express';
import { httpServer } from '#core/manager/http/server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('MetricsManager');

export interface MetricsConfig {
    enableHttp?: boolean;
    enableFileDump?: boolean;
    fileDumpIntervalMs?: number;
}

export class MetricsManager {
    public readonly registry = new Registry();
    
    private dumpTimer: NodeJS.Timeout | null = null;
    private isDumping = false;

    public readonly interactionsTotal = new Counter({
        name: 'discord_interactions_total',
        help: 'Total number of interactions processed',
        labelNames: ['type', 'command', 'status'],
        registers: [this.registry]
    });

    public readonly interactionDuration = new Histogram({
        name: 'discord_interaction_duration_seconds',
        help: 'Time taken to process an interaction',
        labelNames: ['command'],
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [this.registry]
    });

    public readonly eventsTotal = new Counter({
        name: 'discord_events_total',
        help: 'Total number of gateway events received',
        labelNames: ['event'],
        registers: [this.registry]
    });

    public readonly rateLimitsTotal = new Counter({
        name: 'discord_rate_limits_total',
        help: 'Total number of rate limit blocks triggered',
        labelNames: ['bucket'],
        registers: [this.registry]
    });

    public readonly activeGuilds = new Gauge({
        name: 'discord_active_guilds',
        help: 'Number of guilds the bot is currently in',
        registers: [this.registry]
    });

    public async init(config: MetricsConfig = {}): Promise<void> {
        const enableHttp = config.enableHttp ?? true;
        const enableFileDump = config.enableFileDump ?? true;
        const intervalMs = config.fileDumpIntervalMs ?? 60000;

        collectDefaultMetrics({ register: this.registry, prefix: 'bot_' });

        if (enableHttp) {
            this.registerHttpRoutes();
        }

        if (enableFileDump) {
            await this.startFileDumper(intervalMs);
        }
        
        log.info('Metrics Manager initialized.');
    }

    public stop(): void {
        if (this.dumpTimer) {
            clearInterval(this.dumpTimer);
            this.dumpTimer = null;
        }
        
        this.registry.clear();
        log.info('Metrics Manager shut down safely.');
    }

    private registerHttpRoutes(): void {
        const router = Router();

        router.get('/metrics', async (req: Request, res: Response) => {
            try {
                const metrics = await this.registry.metrics();
                res.setHeader('Content-Type', this.registry.contentType);
                res.send(metrics);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`Prometheus scrape failed: ${err.message}`);
                res.status(500).send('Internal Server Error: Failed to generate metrics');
            }
        });

        router.get('/metrics.json', async (req: Request, res: Response) => {
            try {
                const metrics = await this.registry.getMetricsAsJSON();
                res.setHeader('Content-Type', 'application/json');
                res.json(metrics);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`JSON metrics scrape failed: ${err.message}`);
                res.status(500).json({ error: 'Failed to generate metrics' });
            }
        });

        httpServer.registerRouter('', router);
    }

    private async startFileDumper(intervalMs: number): Promise<void> {
        const dir = path.join(process.cwd(), '.data', 'metrics');
        await fs.mkdir(dir, { recursive: true });
        
        const filePath = path.join(dir, 'metrics_latest.json');

        this.dumpTimer = setInterval(() => this.dumpToFile(filePath), intervalMs);
        this.dumpTimer.unref(); 
        
        log.info(`Metrics File Dumper active. Writing to disk every ${intervalMs / 1000}s`);
    }

    private async dumpToFile(filePath: string): Promise<void> {
        if (this.isDumping) return;
        this.isDumping = true;

        try {
            const rawMetrics = await this.registry.getMetricsAsJSON();
            const payload = {
                timestamp: new Date().toISOString(),
                metrics: rawMetrics
            };

            const tempPath = `${filePath}.tmp`;
            
            await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
            await fs.rename(tempPath, filePath);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Failed to dump metrics to disk: ${err.message}`);
        } finally {
            this.isDumping = false;
        }
    }
}

export const metricsManager = new MetricsManager();