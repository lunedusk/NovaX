import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('SqlRegistry');
const isProd = process.env.NODE_ENV === 'production';

export class SqlRegistry {
    private engines = new Map<string, DataSource>();

    public async connect(alias: string, uri: string, entities: any[] = [], poolSize: number = 10): Promise<void> {
        if (this.engines.has(alias)) return;

        const url = new URL(uri);
        const protocol = url.protocol.replace(':', '');

        let dbType: DataSourceOptions['type'];
        
        if (['postgres', 'postgresql'].includes(protocol)) dbType = 'postgres';
        else if (protocol === 'mysql') dbType = 'mysql';
        else if (protocol === 'mariadb') dbType = 'mariadb';
        else if (protocol === 'sqlite') dbType = 'better-sqlite3';
        else throw new Error(`Unsupported ORM dialect: ${protocol}`);

        log.info(`Initializing TypeORM (${dbType}) for: [${alias}]`);

        const options: DataSourceOptions = {
            type: dbType as any, 
            url: dbType === 'better-sqlite3' ? undefined : uri,
            database: dbType === 'better-sqlite3' ? url.pathname.replace(/^\//, '') : undefined,
            synchronize: !isProd,
            logging: false,
            entities: entities,
            extra: dbType !== 'better-sqlite3' ? { max: poolSize } : undefined,
        };

        const engine = new DataSource(options);
        await engine.initialize();
        this.engines.set(alias, engine);
        log.info(`TypeORM [${alias}] connected successfully.`);
    }

    public get(alias: string): DataSource {
        const engine = this.engines.get(alias);
        if (!engine) throw new Error(`TypeORM engine [${alias}] not found!`);
        return engine;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, engine] of this.engines.entries()) {
            try {
                await engine.query('SELECT 1');
                status[alias] = true;
            } catch {
                status[alias] = false;
            }
        }
        return status;
    }

    public async disconnectAll(): Promise<void> {
        for (const [alias, engine] of this.engines.entries()) {
            if (engine.isInitialized) {
                log.info(`Closing TypeORM connection [${alias}]...`);
                await engine.destroy();
            }
            this.engines.delete(alias);
        }
    }
}

export const ormDB = new SqlRegistry();