import { type Client } from 'discord.js';
import { getLogger, type Logger } from '#core/utils/logger.js';

import { assetsDomain, type AssetsDomain } from './assets.js';
import { systemDomain } from './system.js';
import { discordDomain } from './discord.js';
import { dbDomain, type DatabaseDomain } from './db.js';
import { netDomain } from './net.js';
import { toolboxDomain } from './toolbox.js';
import { controlDomain, type ControlDomain } from './control.js';
import { crossHostDomain, type CrossHostDomain } from './crossHost.js';
import { permissionsDomain, type PermissionsDomain } from './permissions.js';
import { tokenDomain, type TokenDomain } from './token.js';
import { cacheDomain, type CacheDomain } from './cache.js';
import { guildDomain, type GuildDomain } from './guild.js';
import { setHeartClient } from './holders.js';

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

    readonly control: ControlDomain;
    readonly crossHost: CrossHostDomain;
    readonly permissions: PermissionsDomain;
    readonly token: TokenDomain;
    readonly cache: CacheDomain;
    readonly guild: GuildDomain;
}

export class HeartFactory {
    public static create(
        pluginId: string,
        client: Client<true>,
        overrides?: Partial<IHeart>,
    ): IHeart {
        setHeartClient(client);
        return Object.freeze({
            id: pluginId,
            client: overrides?.client ?? client,

            log: overrides?.log ?? getLogger(`Plugin:${pluginId}`),

            assets: overrides?.assets ?? assetsDomain,
            system: overrides?.system ?? systemDomain,
            discord: overrides?.discord ?? discordDomain,
            db: overrides?.db ?? dbDomain,
            net: overrides?.net ?? netDomain,
            toolbox: overrides?.toolbox ?? toolboxDomain,

            control: overrides?.control ?? controlDomain,
            crossHost: overrides?.crossHost ?? crossHostDomain,
            permissions: overrides?.permissions ?? permissionsDomain,
            token: overrides?.token ?? tokenDomain,
            cache: overrides?.cache ?? cacheDomain,
            guild: overrides?.guild ?? guildDomain,
        });
    }
}

export type { ControlDomain } from './control.js';
export type { CrossHostDomain, PluginBusHandler } from './crossHost.js';
export type { PermissionsDomain } from './permissions.js';
export type { TokenDomain } from './token.js';
export type { CacheDomain } from './cache.js';
export type { GuildDomain } from './guild.js';
export {
    setHeartPermissions,
    setHeartTokenManager,
    setHeartClient,
} from './holders.js';
export {
    registerFleetShutdownPublisher,
    registerMachineShutdownPublisher,
    registerShardOwnerResolver,
    registerGaugeHandlers,
    performLocalShutdown,
} from './control.js';
export { setCrossHostBus, getCrossHostBus } from './crossHost.js';
