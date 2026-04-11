import { type Client } from 'discord.js';
import { getLogger, type Logger } from '#core/utils/logger.js';

import { assetsDomain, type AssetsDomain } from './assets.js';
import { systemDomain } from './system.js';
import { discordDomain } from './discord.js';
import { dbDomain, type DatabaseDomain } from './db.js';
import { netDomain } from './net.js';
import { toolboxDomain } from './toolbox.js';

export interface IHeart {
    readonly id: string;
    readonly client: Client<true>;
    
    readonly log: Logger;

    readonly assets: AssetsDomain;
    readonly system: typeof systemDomain;
    readonly discord: typeof discordDomain;
    readonly db: DatabaseDomain;
    readonly net: typeof netDomain;
    readonly toolbox: typeof toolboxDomain;
}

export class HeartFactory {
    public static create(
        pluginId: string, 
        client: Client<true>, 
        overrides?: Partial<IHeart>
    ): IHeart {
        return Object.freeze({
            id: pluginId,
            client: overrides?.client ?? client,
            
            log: overrides?.log ?? getLogger(`Plugin:${pluginId}`),
            
            assets: overrides?.assets ?? assetsDomain,
            system: overrides?.system ?? systemDomain,
            discord: overrides?.discord ?? discordDomain,
            db: overrides?.db ?? dbDomain,
            net: overrides?.net ?? netDomain,
            toolbox: overrides?.toolbox ?? toolboxDomain
        });
    }
}