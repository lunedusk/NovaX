import type { IHeart } from '#core/heart/index.js';
import type {
    ChatInputCommandInteraction,
    AnySelectMenuInteraction,
    ButtonInteraction,
    Interaction,
} from 'discord.js';
import type { PluginManifest } from '#core/bases/Plugin.js';
import type { InteractionRouteMetadata } from '#core/manager/interaction/registry.js';
import type { RouteAccessConfig } from '#core/manager/permissions.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { TTLCache } from '#core/helpers/cache.js';
import { DecoratorCooldownRegistry } from '#core/decorators/cooldown.js';
import type { PluginManager } from '#core/loader/index.js';

export type HelpAccessConfig = RouteAccessConfig & {
    cooldown?: number;
    cooldownLimit?: number;
};

export interface HelpCommandInfo {
    name: string;
    displayName: string;
    description: string;
    cooldownWindow: number;
    cooldownLimit: number;
    args: string;
    rawFormatted: string;
    type: 'flat' | 'has_subs' | 'has_groups' | 'group' | 'subcommand';
    children: HelpCommandInfo[];
    access?: HelpAccessConfig;
}

export interface HelpPluginGroup {
    id: string;
    name: string;
    emoji: string;
    commands: HelpCommandInfo[];
}

interface ApplicationCommandOptionLike {
    type?: number;
    name: string;
    description?: string;
    required?: boolean;
    options?: ApplicationCommandOptionLike[];
}

interface ApplicationCommandDataLike {
    name?: string;
    description?: string;
    options?: ApplicationCommandOptionLike[];
    toJSON?: () => ApplicationCommandDataLike;
}

type InteractionRegistry = typeof import('#core/manager/interaction/registry.js').interactionRegistry;

export class HelpUtils {
    private static readonly pluginCache = new TTLCache<string, HelpPluginGroup>({ name: 'help.plugin', defaultTTL: 3600000 });

    public static clearCache(pluginId?: string): void {
        if (pluginId) this.pluginCache.delete(pluginId);
        else this.pluginCache.clear();
    }

    public static getEmoji(heart: IHeart, key: string): string {
        const raw = heart.assets.lang.get(heart.id, `commands.help.emojis.${key}`);
        const [custom, fallback] = raw.split('|');
        return custom && custom.includes('<') ? custom : fallback || '🔹';
    }

    private static parseArgs(heart: IHeart, options: ApplicationCommandOptionLike[]): string {
        if (!options || options.length === 0) return heart.assets.lang.get(heart.id, 'commands.help.noArgs');
        const argListFmt = heart.assets.lang.get(heart.id, 'commands.help.format.argumentList');
        const reqTag = heart.assets.lang.get(heart.id, 'commands.help.format.requiredTag');
        const optTag = heart.assets.lang.get(heart.id, 'commands.help.format.optionalTag');
        return options
            .map((o) =>
                argListFmt
                    .replace('%s', o.name)
                    .replace('%s', o.required ? reqTag : optTag)
                    .replace('%s', o.description ?? ''),
            )
            .join('\n');
    }

    private static parseSubcommand(
        heart: IHeart,
        pluginId: string,
        baseName: string,
        groupName: string,
        sub: ApplicationCommandOptionLike,
        fallbackWindow: number,
        fallbackLimit: number,
    ): HelpCommandInfo {
        const inlineReq = heart.assets.lang.get(heart.id, 'commands.help.format.argumentInlineReq');
        const inlineOpt = heart.assets.lang.get(heart.id, 'commands.help.format.argumentInlineOpt');

        let inlineArgs = '';
        if (sub.options) {
            inlineArgs = sub.options
                .map((o) => (o.required ? inlineReq.replace('%s', o.name) : inlineOpt.replace('%s', o.name)))
                .join(' ');
        }

        const displayName = `${baseName}${groupName ? ' ' + groupName : ''} ${sub.name} ${inlineArgs}`.trim();

        const slugParts = [pluginId, baseName];
        if (groupName) slugParts.push(groupName);
        slugParts.push(sub.name);
        const predictedSlug = slugParts.join('-');
        const decoratorMeta = DecoratorCooldownRegistry.get(predictedSlug);

        const actualWindow = decoratorMeta?.windowMs ? decoratorMeta.windowMs / 1000 : fallbackWindow;
        const actualLimit = decoratorMeta?.limit ?? fallbackLimit;

        return {
            name: sub.name,
            displayName: displayName,
            description: sub.description || 'No description.',
            cooldownWindow: actualWindow,
            cooldownLimit: actualLimit,
            args: this.parseArgs(heart, sub.options || []),
            rawFormatted: '',
            type: 'subcommand',
            children: [],
        };
    }

    private static buildCacheForPlugin(
        heart: IHeart,
        targetOwnerId: string,
        registry: InteractionRegistry,
        pluginManager: PluginManager | undefined,
    ): void {
        const manifest = pluginManager?.registry?.get(targetOwnerId)?.manifest as
            | (PluginManifest & { emoji?: string; icon?: string })
            | undefined;
        const group: HelpPluginGroup = {
            id: targetOwnerId,
            name: manifest?.name ?? targetOwnerId,
            emoji: manifest?.emoji ?? manifest?.icon ?? this.getEmoji(heart, 'menu'),
            commands: [],
        };

        const formatCmdList = heart.assets.lang.get(heart.id, 'commands.help.format.commandList');

        for (const [cmdName, entry] of registry.chat.getEntries()) {
            if (entry.owner !== targetOwnerId) continue;

            const metadata = entry.metadata as InteractionRouteMetadata | undefined;
            const data = metadata?.data as ApplicationCommandDataLike | undefined;
            const apiData = data?.toJSON ? data.toJSON() : data ?? null;
            const name = apiData?.name ?? cmdName;
            const desc = data?.description ?? apiData?.description ?? 'No description.';

            const access = metadata?.access as HelpAccessConfig | undefined;
            let cooldownWindow = access?.cooldown ?? 0;
            let cooldownLimit = access?.cooldownLimit ?? undefined;

            const baseDecorator =
                DecoratorCooldownRegistry.get(`${targetOwnerId}-${name}-execute`) ??
                DecoratorCooldownRegistry.get(`${targetOwnerId}-${name}`);

            if (baseDecorator) {
                if (baseDecorator.windowMs) cooldownWindow = baseDecorator.windowMs / 1000;
                if (baseDecorator.limit) cooldownLimit = baseDecorator.limit;
            }

            cooldownLimit = cooldownLimit ?? 1;

            const cmdInfo: HelpCommandInfo = {
                name: name,
                displayName: name,
                description: desc,
                cooldownWindow: cooldownWindow,
                cooldownLimit: cooldownLimit,
                args: '',
                rawFormatted: formatCmdList.replace('%s', name).replace('%s', desc),
                type: 'flat',
                children: [],
                access: metadata?.access as HelpAccessConfig | undefined,
            };

            const hasGroup = apiData?.options?.some((o) => o.type === 2);
            const hasSub = apiData?.options?.some((o) => o.type === 1);

            if (hasGroup && apiData?.options) {
                cmdInfo.type = 'has_groups';
                for (const grp of apiData.options.filter((o) => o.type === 2)) {
                    const groupObj: HelpCommandInfo = {
                        name: grp.name,
                        displayName: `${name} ${grp.name}`,
                        description: grp.description ?? '',
                        cooldownWindow: cooldownWindow,
                        cooldownLimit: cooldownLimit,
                        args: '',
                        rawFormatted: '',
                        type: 'group',
                        children: [],
                    };
                    if (grp.options) {
                        for (const sub of grp.options.filter((o) => o.type === 1)) {
                            groupObj.children.push(
                                this.parseSubcommand(
                                    heart,
                                    targetOwnerId,
                                    name,
                                    grp.name,
                                    sub,
                                    cooldownWindow,
                                    cooldownLimit,
                                ),
                            );
                        }
                    }
                    cmdInfo.children.push(groupObj);
                }
            } else if (hasSub && apiData?.options) {
                cmdInfo.type = 'has_subs';
                for (const sub of apiData.options.filter((o) => o.type === 1)) {
                    cmdInfo.children.push(
                        this.parseSubcommand(heart, targetOwnerId, name, '', sub, cooldownWindow, cooldownLimit),
                    );
                }
            } else {
                cmdInfo.args = this.parseArgs(heart, apiData?.options || []);
            }

            group.commands.push(cmdInfo);
        }
        this.pluginCache.set(targetOwnerId, group);
    }

    public static async fetchEcosystemData(
        heart: IHeart,
        interaction: ChatInputCommandInteraction | AnySelectMenuInteraction | ButtonInteraction,
    ): Promise<HelpPluginGroup[]> {
        const { interactionRegistry } = await import('#core/manager/interaction/registry.js');
        const { pluginManager } = await import('#core/loader/index.js');
        const config = heart.assets.config.get<{ help?: { filterByPermissions?: boolean } }>('core');
        const filterEnabled = config?.help?.filterByPermissions ?? true;

        const ownersInRegistry = new Set<string>();
        for (const [, entry] of interactionRegistry.chat.getEntries()) ownersInRegistry.add(entry.owner ?? 'core');

        const result: HelpPluginGroup[] = [];

        for (const ownerId of ownersInRegistry) {
            if (!this.pluginCache.has(ownerId)) {
                this.buildCacheForPlugin(heart, ownerId, interactionRegistry, pluginManager);
            }

            const cachedGroup = this.pluginCache.get(ownerId);
            if (!cachedGroup) continue;
            const userGroup: HelpPluginGroup = { ...cachedGroup, commands: [] };

            for (const cmd of cachedGroup.commands) {
                if (filterEnabled && cmd.access) {
                    const accessCheck = await permissionsManager!.canExecute(
                        interaction as Interaction,
                        cmd.access,
                    );
                    if (!accessCheck.allowed) continue;
                }
                userGroup.commands.push(cmd);
            }

            if (!filterEnabled || userGroup.commands.length > 0) result.push(userGroup);
        }

        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    public static buildFullInfoBlocks(heart: IHeart, commands: HelpCommandInfo[]): string[] {
        const headerFmt = heart.assets.lang.get(heart.id, 'commands.help.format.commandDetailHeader');
        const detailFmt = heart.assets.lang.get(heart.id, 'commands.help.format.commandDetail');

        return commands.map((cmd) => {
            const cdStr =
                cmd.cooldownWindow > 0
                    ? heart.assets.lang.get(heart.id, 'commands.help.cooldownFormat', {
                          limit: cmd.cooldownLimit,
                          time: cmd.cooldownWindow,
                      })
                    : heart.assets.lang.get(heart.id, 'commands.help.noCooldown');

            const header = headerFmt.replace('%s', cmd.displayName);
            const body = detailFmt
                .replace('%s', cmd.description)
                .replace('%s', `${HelpUtils.getEmoji(heart, 'cooldown')} ${cdStr}`)
                .replace('%s', cmd.args);
            return `${header}\n${body}`;
        });
    }

    public static chunkTextBlocks(blocks: string[], maxChars: number): string[] {
        const pages: string[] = [];
        let currentPage = '';
        for (const block of blocks) {
            if (currentPage.length + block.length + 4 > maxChars && currentPage.length > 0) {
                pages.push(currentPage.trim());
                currentPage = '';
            }
            currentPage += block + '\n\n';
        }
        if (currentPage.length > 0) pages.push(currentPage.trim());
        return pages;
    }

    public static chunkCommands(commands: HelpCommandInfo[], maxChars: number): HelpCommandInfo[][] {
        const pages: HelpCommandInfo[][] = [];
        let currentPage: HelpCommandInfo[] = [];
        let currentCharCount = 0;
        for (const cmd of commands) {
            const len = cmd.rawFormatted.length + 1;
            if (currentCharCount + len > maxChars && currentPage.length > 0) {
                pages.push(currentPage);
                currentPage = [];
                currentCharCount = 0;
            }
            currentPage.push(cmd);
            currentCharCount += len;
        }
        if (currentPage.length > 0) pages.push(currentPage);
        return pages;
    }
}
