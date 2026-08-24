import { secrets } from '#core/helpers/secretManager.js';
import { configManager } from '#core/manager/config.js';
import { sqliteDB } from '#core/database/sqlite.js';
import { pgDB } from '#core/database/postgres.js';
import { mongoDB } from '#core/database/mongo.js';

export type DataEngine = 'sqlite' | 'postgres' | 'mongo';

export interface BackendChoice {
    engine: DataEngine;
    alias: string;
}

export interface ResolveBackendInput {
    configSection?: string;
    configEngine?: string | null;
    configAlias?: string | null;
    envEngineKey: string;
    envAliasKey: string;
    defaultAlias?: string;
}

function normalizeEngine(raw: string | null | undefined): DataEngine | null {
    if (!raw) return null;
    const v = raw.toString().trim().toLowerCase();
    if (v === 'sqlite' || v === 'native-sqlite') return 'sqlite';
    if (v === 'postgres' || v === 'postgresql' || v === 'pg' || v === 'native-pg') return 'postgres';
    if (v === 'mongo' || v === 'mongodb') return 'mongo';
    return null;
}

function readConfigEngineAlias(section: string | undefined): { engine?: string; alias?: string } {
    if (!section) return {};
    try {
        const cfg = configManager.get<Record<string, unknown>>(section);
        if (!cfg) return {};
        return {
            engine: cfg.engine != null ? String(cfg.engine) : undefined,
            alias: cfg.alias != null ? String(cfg.alias) : undefined,
        };
    } catch {
        return {};
    }
}

function isConnected(engine: DataEngine, alias: string): boolean {
    try {
        if (engine === 'sqlite') return sqliteDB.has(alias);
        if (engine === 'postgres') return pgDB.has(alias);
        if (engine === 'mongo') return mongoDB.has(alias);
    } catch {
        return false;
    }
    return false;
}

export function resolveBackend(input: ResolveBackendInput): BackendChoice {
    const fromConfig = readConfigEngineAlias(input.configSection);
    const engineRaw =
        input.configEngine ??
        fromConfig.engine ??
        secrets.getOptional(input.envEngineKey) ??
        null;
    const alias =
        (input.configAlias ??
            fromConfig.alias ??
            secrets.getOptional(input.envAliasKey) ??
            input.defaultAlias ??
            'main')
            .toString()
            .trim() || 'main';

    const forced = normalizeEngine(engineRaw);
    if (forced) {
        if (!isConnected(forced, alias)) {
            throw new Error(
                `Data backend ${forced} alias "${alias}" is not connected (requested via config/env).`,
            );
        }
        return { engine: forced, alias };
    }

    const preference: DataEngine[] = ['sqlite', 'postgres', 'mongo'];
    for (const engine of preference) {
        if (isConnected(engine, alias)) {
            return { engine, alias };
        }
    }

    throw new Error(
        `No data backend connected for alias "${alias}" (tried sqlite → postgres → mongo).`,
    );
}

export function resolvePermissionsBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    return resolveBackend({
        configSection: 'permissions',
        configEngine: cfg?.engine,
        configAlias: cfg?.alias,
        envEngineKey: 'PermissionsEngine',
        envAliasKey: 'PermissionsDbAlias',
        defaultAlias: 'main',
    });
}

export function resolveTokenBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    return resolveBackend({
        configSection: 'token',
        configEngine: cfg?.engine,
        configAlias: cfg?.alias,
        envEngineKey: 'TokenEngine',
        envAliasKey: 'TokenDbAlias',
        defaultAlias: 'main',
    });
}

export function resolveGuildGateBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    return resolveBackend({
        configSection: 'guildGate',
        configEngine: cfg?.engine,
        configAlias: cfg?.alias,
        envEngineKey: 'GuildGateEngine',
        envAliasKey: 'GuildGateDbAlias',
        defaultAlias: 'main',
    });
}

export function resolveDashboardBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    return resolveBackend({
        configSection: 'dashboard',
        configEngine: cfg?.engine,
        configAlias: cfg?.alias,
        envEngineKey: 'DashboardEngine',
        envAliasKey: 'DashboardDbAlias',
        defaultAlias: 'main',
    });
}
