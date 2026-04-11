import { getLogger } from '#core/utils/logger.js';
import { redisDB } from './redis.js';
import { ormDB } from './sqlite.js'; 
import { mongoDB } from './mongo.js';
import { pgDB } from './postgres.js';

const log = getLogger('DBManager');

export interface DbConfig {
    alias: string;
    uri: string;
    engine?: 'native-pg' | 'typeorm' | 'redis' | 'mongo'; 
    entities?: any[];
    poolSize?: number;
    maxRetries?: number;
}

export class DatabaseManager {
    private static async withRetry(operation: () => Promise<void>, alias: string, retries = 5): Promise<void> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await operation();
                return;
            } catch (error) {
                if (attempt === retries) throw error;
                const delay = Math.min(1000 * (2 ** attempt), 10000);
                log.warn(`DB [${alias}] connection failed. Retrying in ${delay / 1000}s... (Attempt ${attempt}/${retries})`);
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }

    public static async init(config: DbConfig): Promise<void> {
        const retries = config.maxRetries ?? 5;
        const poolSize = config.poolSize ?? 10;

        await this.withRetry(async () => {
            const url = new URL(config.uri);
            const protocol = url.protocol.replace(':', '');

            if (config.engine === 'native-pg' || protocol === 'postgres-native') {
                await pgDB.connect(config.alias, config.uri, poolSize);
                return;
            }

            switch (protocol) {
                case 'redis':
                case 'rediss':
                    await redisDB.connect(config.alias, config.uri);
                    break;
                case 'mongodb':
                case 'mongodb+srv':
                    await mongoDB.connect(config.alias, config.uri, poolSize);
                    break;
                case 'postgres':
                case 'postgresql':
                case 'mysql':
                case 'mariadb':
                case 'sqlite':
                    await ormDB.connect(config.alias, config.uri, config.entities || [], poolSize);
                    break;
                default:
                    log.warn(`Unknown protocol: ${protocol} for alias [${config.alias}]. Skipping.`);
            }
        }, config.alias, retries).catch((err) => {
            const error = err as Error;
            log.error(`CRITICAL: Exhausted retries for DB [${config.alias}]. ${error.message}`, { stack: error.stack });
            throw error;
        });
    }

    public static async healthCheck(): Promise<Record<string, boolean>> {
        log.debug('Running global database health check...');
        const status: Record<string, boolean> = {};

        Object.assign(status, await redisDB.pingAll());
        Object.assign(status, await pgDB.pingAll());
        Object.assign(status, await mongoDB.pingAll());
        Object.assign(status, await ormDB.pingAll());

        return status;
    }

    public static async closeAll(): Promise<void> {
        log.warn('Initiating global database shutdown...');
        try {
            await Promise.all([
                redisDB.disconnectAll(),
                ormDB.disconnectAll(),
                mongoDB.disconnectAll(),
                pgDB.disconnectAll()
            ]);
            log.info('All databases closed safely.');
        } catch (error) {
            const err = error as Error;
            log.error(`Error during database shutdown: ${err.message}`, { stack: err.stack });
        }
    }
}

export { redisDB, ormDB, mongoDB, pgDB };