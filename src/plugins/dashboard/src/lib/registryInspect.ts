import { interactionRegistry } from '#core/manager/interaction/registry.js';
import { eventBus } from '#core/manager/events/EventBus.js';
import { httpServer } from '#core/manager/http/server.js';
import { configManager } from '#core/manager/config.js';
import type { RouteAccessConfig, HttpRouteAccessConfig } from '#core/manager/permissions.js';

export interface CommandRegistryEntry {
    id: string;
    pluginId: string | null;
    description: string | null;
    category: string | null;
    guildOnly: boolean | null;
    dmAllowed: boolean | null;
    cooldownMs: number | null;
    requiredBits: string[];
    discordPermissions: string[];
    options: Array<{
        name: string;
        type: string;
        description: string | null;
        required: boolean;
    }>;
}

export interface EventRegistryEntry {
    name: string;
    pluginId: string | null;
    once: boolean;
    priority: number;
}

export interface RouteRegistryEntry {
    method: string;
    path: string;
    pluginId: string | null;
    description: string | null;
    requiredBits: string[];
    bitsMode: 'all' | 'any';
    public: boolean;
}

function asStringArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') return [value];
    return [];
}

function extractBits(access: RouteAccessConfig | undefined): string[] {
    if (!access) return [];
    const bits = new Set<string>();
    if (access.serverBit) {
        for (const b of asStringArray(access.serverBit)) bits.add(b);
    }
    if (typeof access.require === 'string') bits.add(access.require);
    if (Array.isArray(access.require)) {
        for (const b of access.require) {
            if (typeof b === 'string') bits.add(b);
        }
    }
    return Array.from(bits);
}

function extractDiscordPerms(access: RouteAccessConfig | undefined): string[] {
    if (!access?.userPermissions) return [];
    return asStringArray(access.userPermissions);
}

function optionTypeName(type: unknown): string {
    if (typeof type === 'string') return type;
    if (typeof type === 'number') return String(type);
    return 'unknown';
}

function extractOptions(data: unknown): CommandRegistryEntry['options'] {
    if (!data || typeof data !== 'object') return [];
    const d = data as { options?: unknown[]; toJSON?: () => { options?: unknown[] } };
    let options: unknown[] = [];
    if (Array.isArray(d.options)) {
        options = d.options;
    } else if (typeof d.toJSON === 'function') {
        try {
            const json = d.toJSON();
            if (Array.isArray(json?.options)) options = json.options;
        } catch {
            options = [];
        }
    }
    const out: CommandRegistryEntry['options'] = [];
    for (const opt of options) {
        if (!opt || typeof opt !== 'object') continue;
        const o = opt as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name : null;
        if (!name) continue;
        out.push({
            name,
            type: optionTypeName(o.type),
            description: typeof o.description === 'string' ? o.description : null,
            required: o.required === true,
        });
    }
    return out;
}

function extractDescription(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as { description?: string; toJSON?: () => { description?: string } };
    if (typeof d.description === 'string') return d.description;
    if (typeof d.toJSON === 'function') {
        try {
            const json = d.toJSON();
            if (typeof json?.description === 'string') return json.description;
        } catch {
            return null;
        }
    }
    return null;
}

export function inspectCommands(): CommandRegistryEntry[] {
    const entries = interactionRegistry.chat.getEntries();
    const out: CommandRegistryEntry[] = [];
    for (const [id, entry] of entries.entries()) {
        const meta = entry.metadata;
        const data = meta?.data;
        const access = meta?.access as RouteAccessConfig | undefined;
        const cfg = access as RouteAccessConfig & { cooldown?: number } | undefined;
        let dmAllowed: boolean | null = null;
        if (cfg && typeof cfg.allowInDm === 'boolean') dmAllowed = cfg.allowInDm;
        let guildOnly: boolean | null = null;
        if (dmAllowed === false) guildOnly = true;
        else if (dmAllowed === true) guildOnly = false;
        out.push({
            id,
            pluginId: entry.owner ?? null,
            description: extractDescription(data),
            category: null,
            guildOnly,
            dmAllowed,
            cooldownMs: typeof cfg?.cooldown === 'number' ? cfg.cooldown : null,
            requiredBits: extractBits(access),
            discordPermissions: extractDiscordPerms(access).map(String),
            options: extractOptions(data),
        });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
}

export function inspectEvents(): EventRegistryEntry[] {
    return eventBus.listInspect().map((e) => ({
        name: e.name,
        pluginId: e.pluginId,
        once: e.once,
        priority: e.priority,
    }));
}

function loadHttpRoutePolicy(): HttpRouteAccessConfig[] {
    try {
        const raw = configManager.get('permissions') as { httpRoutes?: HttpRouteAccessConfig[] } | null;
        if (raw && Array.isArray(raw.httpRoutes)) return raw.httpRoutes;
    } catch {
        return [];
    }
    return [];
}

export function inspectRoutes(): RouteRegistryEntry[] {
    const out: RouteRegistryEntry[] = [];
    const seen = new Set<string>();

    for (const r of loadHttpRoutePolicy()) {
        const method = String(r.method ?? '*').toUpperCase();
        const path = String(r.path ?? '');
        if (!path) continue;
        const key = `${method} ${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            method,
            path,
            pluginId: null,
            description: null,
            requiredBits: Array.isArray(r.bits) ? r.bits.map(String) : [],
            bitsMode: r.bitsMode === 'any' ? 'any' : 'all',
            public: r.public === true,
        });
    }

    for (const basePath of httpServer.listMounts()) {
        const key = `* ${basePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            method: '*',
            path: basePath,
            pluginId: null,
            description: 'Mounted router base path',
            requiredBits: [],
            bitsMode: 'all',
            public: false,
        });
    }

    out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    return out;
}
