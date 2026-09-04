import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLogger } from '#core/utils/logger.js';
import { buildRequirementContext, evaluateRequirements, requirementsMode } from './requirements.js';
import type { IHeart } from '#core/heart/index.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { handlerRegistry } from '#core/manager/handler/registry.js';

const log = getLogger('HandlerLoader');

const LIFECYCLE_TIMEOUT_MS = 15_000;
const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function withInitializeTimeout(promise: Promise<void>, pluginId: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(
                `onInitialize() timed out after ${LIFECYCLE_TIMEOUT_MS}ms for handler "${pluginId}.${name}"`
            ));
        }, LIFECYCLE_TIMEOUT_MS);

        promise.then(
            () => { clearTimeout(timer); resolve(); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

export class HandlerLoader {
    private static async getFiles(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') log.warn(`Failed to read directory ${dir}: ${err.message}`);
            return [];
        });

        const paths = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.resolve(dir, entry.name);
            if (entry.isDirectory()) return this.getFiles(fullPath);
            return fullPath.match(/\.(js)$/) ? fullPath : [];
        }));

        return paths.flat();
    }

    public static async loadForPlugin(
        pluginDir: string,
        pluginId: string,
        heart: IHeart
    ): Promise<void> {
        const handlersDir = path.join(pluginDir, 'src', 'handlers');
        const files = await this.getFiles(handlersDir);
        if (files.length === 0) return;

        let loadedCount = 0;

        const loadPromises = files.map(async (file) => {
            try {
                const baseUrl = pathToFileURL(file).href;
                const importUrl = `${baseUrl}?v=${Date.now()}`;

                const Module = await import(importUrl);
                const HandlerClass = Module.default;

                if (typeof HandlerClass !== 'function' ||
                    !(HandlerClass.prototype instanceof BaseHandler)) {
                    log.warn(`[${pluginId}] ${path.basename(file)} does not export a valid BaseHandler. Skipping.`);
                    return;
                }

                const instance = new HandlerClass(heart);
                if (instance.requirements) {
                    const ctx = buildRequirementContext(heart, pluginId);
                    const req = await evaluateRequirements(instance.requirements, ctx);
                    if (!req.ok) {
                        const mode = requirementsMode(instance.requirements, 'soft');
                        if (mode === 'strict') {
                            throw new Error(`Handler ${instance.name} requirements failed: ${req.reasons.join('; ')}`);
                        }
                        log.info(`[${pluginId}] skipped handler ${instance.name}: ${req.reasons.join('; ')}`);
                        return;
                    }
                }

                if (!instance.name || typeof instance.name !== 'string') {
                    log.warn(`[${pluginId}] Handler in ${path.basename(file)} has a missing or invalid name. Skipping.`);
                    return;
                }

                if (!VALID_IDENTIFIER.test(instance.name)) {
                    log.warn(
                        `[${pluginId}] Handler name "${instance.name}" in ${path.basename(file)} is not a valid ` +
                        `JavaScript identifier. Must match /^[a-zA-Z_$][a-zA-Z0-9_$]*$/. Skipping.`
                    );
                    return;
                }

                handlerRegistry.register(pluginId, instance.name, instance);

                try {
                    await withInitializeTimeout(instance.onInitialize(), pluginId, instance.name);
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    log.error(
                        `[${pluginId}] onInitialize() failed for handler "${instance.name}": ${err.message}. Unregistering.`
                    );
                    handlerRegistry.unregister(pluginId, instance.name);
                    return;
                }

                loadedCount++;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${pluginId}] Failed to load handler ${path.basename(file)}: ${err.message}`);
            }
        });

        await Promise.all(loadPromises);
        if (loadedCount > 0) log.info(`[${pluginId}] Autoloaded ${loadedCount} handlers.`);
    }
}