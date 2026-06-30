import { DatabaseManager, type DbConfig, novaDB } from '#core/database/index.js';
import { secrets } from './helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';
import path from 'node:path';
import fs from 'node:fs';
import { sqliteDB } from '#core/database/sqlite.js';  

const log = getLogger('DatabaseBootstrap');

function parseIntOrNull(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function loadDbConfigsFromEnv(): DbConfig[] {
    const raw = secrets.getOptional('Database') ?? '{}';

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        log.error('Failed to parse Database env var as JSON:', err);
        return [];
    }

    if (typeof parsed !== 'object' || parsed === null) {
        log.error('Database env var must be a JSON object of alias -> { uri, engine?, poolSize?, maxRetries? }');
        return [];
    }

    const configs: DbConfig[] = [];

    for (const [alias, value] of Object.entries(parsed as Record<string, any>)) {
        if (!value || typeof value !== 'object') {
            log.warn(`Skipping Database[${alias}] because it is not an object.`);
            continue;
        }

        const uri = value.uri as string | undefined;
        if (!uri) {
            log.warn(`Skipping Database[${alias}] because "uri" is missing.`);
            continue;
        }

        const engine = value.engine as DbConfig['engine'] | undefined;
        const poolSize = parseIntOrNull(value.poolSize);
        const maxRetries = parseIntOrNull(value.maxRetries);

        const cfg: DbConfig = {
            alias,
            uri,
            engine,
            poolSize,
            maxRetries,
        };

        configs.push(cfg);
    }

    return configs;
}

export async function initAllDatabases(): Promise<void> {
    const configs = loadDbConfigsFromEnv();

    if (!configs.length) {
        log.warn('No database configurations found in env variable "Database". Proceeding to verify defaults...');
    }

    for (const cfg of configs) {
        try {
            log.info(`Initializing database [${cfg.alias}]...`);
            await DatabaseManager.init(cfg);
            log.info(`Database [${cfg.alias}] initialized successfully.`);
        } catch (error) {
            const err = error as Error;
            log.error(`Failed to initialize database [${cfg.alias}]: ${err.message}`, { stack: err.stack });
        }
    }

    try {
        const activeNovaDBs = await novaDB.pingAll();

        if (!activeNovaDBs['main']) {
            const disableDefaultNovaDB = secrets.getBoolean('DisableDefaultNovaDB', false);

            if (disableDefaultNovaDB) {
                log.warn('DisableDefaultNovaDB is set to true. Skipping Default "main" NovaDB Instance, this may cause core plugins to fail, it is recommended to configure a "main" NovaDB instance in the Database env variable or turn DisableDefaultNovaDB to false or null.');
            } else {
                await DatabaseManager.init({
                    alias: 'main',
                    uri: 'novadb://local',
                    engine: 'native-novadb',
                    maxRetries: 3
                });

                log.info('Default "main" NovaDB instance fallback completed successfully.');
            }
        }
    } catch (error) {
        const err = error as Error;
        log.error(`CRITICAL: Failed to provision default fallback NovaDB: ${err.message}`, { stack: err.stack });
        throw err;
    }

    const hasSqliteMain = (() => {
        try { sqliteDB.get('main'); return true; } catch { return false; }
    })();

    if (!hasSqliteMain) {
        const disableDefaultSqlite = secrets.getBoolean('DisableDefaultSqlite', false);

        if (disableDefaultSqlite) {
            log.warn('DisableDefaultSqlite is set to true. Skipping default "main" SQLite instance. The permission system and other core features that depend on SQLite will not function.');
        } else {
            const sqliteDir = path.join(process.cwd(), '.data', 'database-sqlite');
            if (!fs.existsSync(sqliteDir)) {
                fs.mkdirSync(sqliteDir, { recursive: true });
            }

            const sqlitePath = path.join(sqliteDir, 'main.db');
            sqliteDB.connect('main', sqlitePath);

            log.info('Default "main" SQLite instance provisioned at .data/database-sqlite/main.db');
        }
    }

}
