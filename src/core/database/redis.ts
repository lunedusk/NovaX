import { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('RedisDB');

interface RedisClients {
    main: Redis;
    pub: Redis;
    sub: Redis;
}

export class RedisRegistry {
    private instances = new Map<string, RedisClients>();

    public async connect(alias: string, uri: string): Promise<void> {
        if (this.instances.has(alias)) return;

        log.info(`Initializing Redis triad (Main, Pub, Sub) for: [${alias}]`);

        const main = new Redis(uri, { lazyConnect: true, maxRetriesPerRequest: 3 });
        const pub = new Redis(uri, { lazyConnect: true, maxRetriesPerRequest: 3 });
        const sub = new Redis(uri, { lazyConnect: true, maxRetriesPerRequest: 3 });

        const attachListeners = (client: Redis, name: string) => {
            client.on('error', (err) => log.error(`Redis ${name} [${alias}] Error: ${err.message}`));
            client.on('reconnecting', () => log.warn(`Redis ${name} [${alias}] is reconnecting...`));
            client.on('ready', () => log.info(`Redis ${name} [${alias}] connection restored.`));
        };

        attachListeners(main, 'Main');
        attachListeners(pub, 'Pub');
        attachListeners(sub, 'Sub');

        await Promise.all([main.connect(), pub.connect(), sub.connect()]);
        this.instances.set(alias, { main, pub, sub });
        log.info(`Redis triad [${alias}] connected successfully.`);
    }

    public get(alias: string): RedisClients {
        const instance = this.instances.get(alias);
        if (!instance) throw new Error(`Redis instance [${alias}] not found!`);
        return instance;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, clients] of this.instances.entries()) {
            try {
                await clients.main.ping();
                status[alias] = true;
            } catch {
                status[alias] = false;
            }
        }
        return status;
    }

    public async disconnectAll(): Promise<void> {
        for (const [alias, clients] of this.instances.entries()) {
            log.info(`Closing Redis triad [${alias}]...`);
            clients.main.disconnect();
            clients.pub.disconnect();
            clients.sub.disconnect();
            this.instances.delete(alias);
        }
    }
}

export const redisDB = new RedisRegistry();