import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLogger } from '#core/utils/logger.js';
import type { IHeart } from '#core/heart/index.js';
import { BaseMiddleware, type MiddlewarePhase, type MiddlewareContext } from '#core/bases/Middleware.js';
import {
    buildRequirementContext,
    evaluateRequirements,
    requirementsMode,
} from './requirements.js';

const log = getLogger('MiddlewareLoader');

interface RegisteredMiddleware {
    readonly pluginId: string;
    readonly instance: BaseMiddleware;
}

const middlewares: RegisteredMiddleware[] = [];

export function listMiddlewares(): readonly RegisteredMiddleware[] {
    return middlewares;
}

export async function registerMiddlewareInstance(
    heart: IHeart,
    pluginId: string,
    instance: BaseMiddleware,
): Promise<boolean> {
    const ctx = buildRequirementContext(heart, pluginId);
    const req = await evaluateRequirements(instance.requirements, ctx);
    if (!req.ok) {
        const mode = requirementsMode(instance.requirements, 'soft');
        if (mode === 'strict') {
            throw new Error(
                `Middleware ${instance.name} requirements failed: ${req.reasons.join('; ')}`,
            );
        }
        log.info(
            `[${pluginId}] skipped middleware ${instance.name}: ${req.reasons.join('; ')}`,
        );
        return false;
    }
    if (middlewares.some((m) => m.pluginId === pluginId && m.instance.name === instance.name)) {
        throw new Error(`Duplicate middleware ${pluginId}.${instance.name}`);
    }
    middlewares.push({ pluginId, instance });
    middlewares.sort((a, b) => a.instance.order - b.instance.order);
    log.info(`[${pluginId}] registered middleware ${instance.name}`);
    return true;
}

export async function runMiddlewarePipeline(
    phase: MiddlewarePhase,
    ctx: MiddlewareContext,
): Promise<'next' | 'stop'> {
    for (const entry of middlewares) {
        if (!entry.instance.phases.includes(phase)) continue;
        const result = await entry.instance.run(ctx);
        if (result === 'stop') return 'stop';
    }
    return 'next';
}

export class MiddlewareLoader {
    private static async getFiles(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') log.warn(`Failed to read directory ${dir}: ${err.message}`);
            return [];
        });
        const paths = await Promise.all(
            entries.map(async (entry) => {
                const fullPath = path.resolve(dir, entry.name);
                if (entry.isDirectory()) return this.getFiles(fullPath);
                return fullPath.endsWith('.js') ? fullPath : [];
            }),
        );
        return paths.flat();
    }

    public static async loadForPlugin(
        pluginDir: string,
        pluginId: string,
        heart: IHeart,
    ): Promise<void> {
        const dir = path.join(pluginDir, 'src', 'middlewares');
        const files = await this.getFiles(dir);
        if (files.length === 0) return;
        let n = 0;
        for (const file of files) {
            try {
                const Module = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
                const Cls = Module.default;
                if (typeof Cls !== 'function' || !(Cls.prototype instanceof BaseMiddleware)) {
                    log.warn(`[${pluginId}] ${path.basename(file)} is not BaseMiddleware`);
                    continue;
                }
                const instance: BaseMiddleware = new Cls(heart);
                if (await registerMiddlewareInstance(heart, pluginId, instance)) n++;
            } catch (err: unknown) {
                log.error(
                    `[${pluginId}] middleware load failed ${path.basename(file)}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
        if (n > 0) log.info(`[${pluginId}] loaded ${n} middleware(s)`);
    }
}
