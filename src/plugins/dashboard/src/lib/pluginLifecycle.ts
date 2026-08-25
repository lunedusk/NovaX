import fs from 'node:fs/promises';
import path from 'node:path';
import { type Dirent } from 'node:fs';
import { type IHeart } from '#core/heart/index.js';
import { pluginManager as coreLoader } from '#core/loader/index.js';
import { HttpError } from './http.js';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

interface LoadedPlugin {
    readonly manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        author?: string;
        dependencies?: string[];
        priority?: number;
    };
    readonly isEnabled: boolean;
    readonly state: string;
}

export interface PluginSummary {
    id: string;
    name: string;
    version: string;
    loaded: boolean;
    enabled: boolean;
    state: string;
    priority: number;
    dependencies: string[];
}

function summarizeLoaded(plugin: LoadedPlugin): PluginSummary {
    return {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        loaded: true,
        enabled: plugin.isEnabled,
        state: plugin.state,
        priority: plugin.manifest.priority ?? 0,
        dependencies: plugin.manifest.dependencies ?? [],
    };
}

async function discoverManifestsFromDisk(): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    let entries: Dirent[];
    try {
        entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
    } catch {
        return out;
    }

    await Promise.all(
        entries
            .filter((e) => e.isDirectory())
            .map(async (entry) => {
                const jsonPath = path.join(PLUGINS_DIR, entry.name, 'manifest.json');
                try {
                    const raw = await fs.readFile(jsonPath, 'utf-8');
                    const manifest = JSON.parse(raw) as Record<string, unknown>;
                    if (manifest?.id) out.set(String(manifest.id), manifest);
                } catch {
                }
            }),
    );
    return out;
}

export async function listAllPlugins(): Promise<PluginSummary[]> {
    const onDisk = await discoverManifestsFromDisk();
    const registry = coreLoader.registry as Map<string, LoadedPlugin>;
    const out: PluginSummary[] = [];
    const seen = new Set<string>();

    for (const [id, manifest] of onDisk) {
        seen.add(id);
        const loaded = registry.get(id);
        out.push({
            id,
            name: String(manifest.name ?? id),
            version: String(manifest.version ?? 'unknown'),
            loaded: !!loaded,
            enabled: loaded?.isEnabled ?? false,
            state: loaded?.state ?? 'not_loaded',
            priority: Number(manifest.priority ?? 0),
            dependencies: Array.isArray(manifest.dependencies) ? (manifest.dependencies as string[]) : [],
        });
    }

    for (const [id, plugin] of registry) {
        if (seen.has(id)) continue;
        out.push(summarizeLoaded(plugin));
    }

    return out;
}

export async function getPluginInfo(pluginId: string): Promise<PluginSummary | null> {
    const all = await listAllPlugins();
    return all.find((p) => p.id === pluginId) ?? null;
}

export function rawLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
    return coreLoader.registry.get(pluginId) as LoadedPlugin | undefined;
}

export async function assertKnownPlugin(pluginId: string): Promise<PluginSummary> {
    const info = await getPluginInfo(pluginId);
    if (!info) throw new HttpError(404, 'not_found', `Plugin ${pluginId} was not found on disk or in the loaded registry.`);
    return info;
}

const LIFECYCLE_COOLDOWN_MS = 30_000;
let lastLifecycleActionAt = 0;

export function assertLifecycleCooldown(): void {
    const elapsed = Date.now() - lastLifecycleActionAt;
    if (elapsed < LIFECYCLE_COOLDOWN_MS) {
        const retryAfterMs = LIFECYCLE_COOLDOWN_MS - elapsed;
        throw new HttpError(
            429,
            'rate_limited',
            `Plugin enable/disable/reload is limited to once per ${LIFECYCLE_COOLDOWN_MS / 1000}s (Discord throttles application-command resyncs, which fire after every batch). Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
            { retryAfterMs },
        );
    }
    lastLifecycleActionAt = Date.now();
}

function dedupe(ids: string[]): string[] {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) throw new HttpError(400, 'bad_request', 'pluginIds must contain at least one non-empty id.');
    return unique;
}

export interface BatchResult {
    success: string[];
    failed: string[];
}

export async function enablePlugins(heart: IHeart, pluginIds: string[]): Promise<BatchResult> {
    const ids = dedupe(pluginIds);
    assertLifecycleCooldown();
    return coreLoader.reload(ids.join('$'), heart.client);
}

export async function reloadPlugins(heart: IHeart, pluginIds: string[]): Promise<BatchResult> {
    const ids = dedupe(pluginIds);
    assertLifecycleCooldown();
    return coreLoader.reload(ids.join('$'), heart.client);
}

export async function disablePlugins(pluginIds: string[]): Promise<BatchResult> {
    const ids = dedupe(pluginIds);
    if (ids.includes('dashboard')) {
        throw new HttpError(400, 'bad_request', 'Refusing to disable the dashboard plugin from within itself.');
    }
    assertLifecycleCooldown();

    const success: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
        if (!coreLoader.registry.has(id)) {
            failed.push(id);
            continue;
        }
        const ok = await coreLoader.disable(id);
        (ok ? success : failed).push(id);
    }
    return { success, failed };
}
