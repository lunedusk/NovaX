import { DatabaseManager, type DbConfig } from '#core/database/index.js'; // adjust path if needed
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DatabaseBootstrap');

function parseIntOrNull(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function loadDbConfigsFromEnv(): DbConfig[] {
    const raw = process.env.Database ?? '{}';

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
        log.warn('No database configurations found in env variable "Database".');
        return;
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
}
