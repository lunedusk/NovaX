import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
    MessageFlags
} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import { Cooldown } from '#core/decorators/cooldown.js';
import { CrossGuildResolver } from '#core/helpers/crossGuild/resolver.js';
import { guildGate } from '#core/manager/guildGate.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';
import { HelpUtils } from '../utils/helpUtils.js';

export default class AdminCommand extends BaseCommand {
    public readonly data = new SlashCommandBuilder()
        .setName('admin')
        .setDescription(this.t('commands.admin.description'))
        .addSubcommand(sub =>
            sub
                .setName('restart')
                .setDescription(this.t('commands.admin.restart.description'))
                .addStringOption(opt =>
                    opt
                        .setName('reason')
                        .setDescription(this.t('commands.admin.restart.reasonDescription'))
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('reload-config')
                .setDescription(this.t('commands.admin.reload.configDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('file')
                        .setDescription(this.t('commands.admin.reload.fileDescription'))
                        .setAutocomplete(true)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('reload-lang')
                .setDescription(this.t('commands.admin.reload.langDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('namespace')
                        .setDescription(this.t('commands.admin.reload.namespaceDescription'))
                        .setAutocomplete(true)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('reload-emoji').setDescription(this.t('commands.admin.reload.emojiDescription'))
        )
        .addSubcommand(sub =>
            sub
                .setName('reload-plugin')
                .setDescription(this.t('commands.admin.reload.pluginDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('id')
                        .setDescription(this.t('commands.admin.reload.idDescription'))
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('cache-pop')
                .setDescription(this.t('commands.admin.cache.popDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('target')
                        .setDescription(this.t('commands.admin.cache.targetDescription'))
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('gate-guild-block')
                .setDescription(this.t('commands.admin.gate.guildBlockDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('guild')
                        .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('reason')
                        .setDescription(this.t('commands.admin.gate.reasonDescription'))
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('gate-guild-unblock')
                .setDescription(this.t('commands.admin.gate.guildUnblockDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('guild')
                        .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('gate-guild-list').setDescription(this.t('commands.admin.gate.guildListDescription'))
        )
        .addSubcommand(sub =>
            sub
                .setName('gate-plugin-block')
                .setDescription(this.t('commands.admin.gate.pluginBlockDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('plugin')
                        .setDescription(this.t('commands.admin.gate.pluginIdDescription'))
                        .setAutocomplete(true)
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('guild')
                        .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('reason')
                        .setDescription(this.t('commands.admin.gate.reasonDescription'))
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('gate-plugin-unblock')
                .setDescription(this.t('commands.admin.gate.pluginUnblockDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('plugin')
                        .setDescription(this.t('commands.admin.gate.pluginIdDescription'))
                        .setAutocomplete(true)
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('guild')
                        .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('gate-plugin-list')
                .setDescription(this.t('commands.admin.gate.pluginListDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('guild')
                        .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                        .setRequired(false)
                )
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: true
    };

    private readonly KNOWN_CACHES = ['cross-guild', 'help-menu'];

    private async requireBotOwner(interaction: ChatInputCommandInteraction): Promise<boolean> {
        const perms = this.heart.system.handler.$get('permissions', 'manager') as
            | PermissionsHandler
            | undefined;
        if (!perms) {
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.access'),
                this.t('commands.admin.messages.unavailable')
            );
            return false;
        }
        const guildId = interaction.guildId ?? undefined;
        const allowed =
            (await perms.hasBit(interaction.user.id, 'bot.owner', guildId)) ||
            (await (perms as any).cachedResolve?.(interaction.user.id, guildId).then(
                (r: { botOwner?: boolean }) => !!r?.botOwner
            ));

        const resolved = await (perms as any).cachedResolve?.(interaction.user.id, guildId);
        if (resolved?.botOwner) return true;
        if (await perms.hasBit(interaction.user.id, 'bot.owner', guildId)) return true;

        await this.replyContainer(
            interaction,
            false,
            this.t('commands.admin.titles.access'),
            this.t('commands.admin.messages.denied')
        );
        return false;
    }

    private resolveGuildId(interaction: ChatInputCommandInteraction): string | null {
        return interaction.options.getString('guild') || interaction.guildId || null;
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        if (!(await this.requireBotOwner(interaction))) return;

        const sub = interaction.options.getSubcommand(true);

        try {
            if (sub === 'restart') return this.handleRestart(interaction);
            if (sub.startsWith('reload-')) return this.handleReload(interaction, sub);
            if (sub === 'cache-pop') return this.handleCache(interaction);
            if (sub.startsWith('gate-')) return this.handleGate(interaction, sub);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Admin command error: ${err.message}`);
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.system'),
                this.t('commands.admin.messages.fatalError', { error: err.message })
            );
        }
    }

    @Cooldown('core-admin-restart', { limit: 1, windowMs: 30_000 })
    private async handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
        const reason = interaction.options.getString('reason') ?? 'No reason provided';
        this.log.warn(`Restart by ${interaction.user.tag} (${interaction.user.id}): ${reason}`);
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.restart'),
            this.t('commands.admin.restart.acknowledged', {
                user: interaction.user.tag,
                reason
            })
        );
        setTimeout(() => process.exit(0), 1000);
    }

    private async handleReload(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        if (sub === 'reload-config') {
            const file = interaction.options.getString('file');
            const manager = this.heart.assets.config as any;
            const success =
                !file || file === 'all' ? await manager.reloadAll() : await manager.reloadFile(file);
            const loaded = manager.getLoadedConfigs?.() ?? [];
            const details = success
                ? this.t('commands.admin.reload.configSuccess', {
                      count: loaded.length,
                      grid: this.formatGrid(loaded)
                  })
                : this.t('commands.admin.reload.configError', { file: file ?? 'all' });
            return this.replyContainer(interaction, success, this.t('commands.admin.titles.config'), details);
        }
        if (sub === 'reload-lang') {
            const namespace = interaction.options.getString('namespace');
            const manager = this.heart.assets.lang as any;
            const success =
                !namespace || namespace === 'all'
                    ? await manager.reloadAll()
                    : await manager.reloadFile(namespace);
            const loaded = manager.getLoadedNamespaces?.() ?? [];
            const details = success
                ? this.t('commands.admin.reload.langSuccess', {
                      count: loaded.length,
                      grid: this.formatGrid(loaded)
                  })
                : this.t('commands.admin.reload.langError', { namespace: namespace ?? 'all' });
            return this.replyContainer(interaction, success, this.t('commands.admin.titles.lang'), details);
        }
        if (sub === 'reload-emoji') {
            const manager =
                (this.heart.assets as any).emojis ??
                ((await import('#core/loader/emoji.js').catch(() => null)) as any)?.emojis;
            if (!manager) throw new Error('EmojiManager is not accessible.');
            const success = await manager.reload();
            const count = Object.keys(manager.getAll?.() || {}).length;
            const details = success
                ? this.t('commands.admin.reload.emojiSuccess', { count })
                : this.t('commands.admin.reload.emojiError');
            return this.replyContainer(interaction, success, this.t('commands.admin.titles.emoji'), details);
        }
        if (sub === 'reload-plugin') {
            const pluginId = interaction.options.getString('id', true);
            return this.handlePluginReload(interaction, pluginId);
        }
    }

    @Cooldown('core-admin-reload-plugin', { limit: 1, windowMs: 30_000 })
    private async handlePluginReload(
        interaction: ChatInputCommandInteraction,
        pluginId: string
    ): Promise<void> {
        const manager =
            (this.heart.system as any).plugins ??
            ((await import('#core/loader/index.js').catch(() => null)) as any)?.pluginManager;
        if (!manager) throw new Error('PluginManager is not accessible.');
        const results = await manager.reload(pluginId, interaction.client);
        const success = results.success.includes(pluginId);
        let details = this.t('commands.admin.reload.pluginError', { pluginId });
        if (success) {
            HelpUtils.clearCache(pluginId);
            const plugin = manager.registry.get(pluginId);
            if (plugin) {
                details = this.t('commands.admin.reload.pluginSuccess', {
                    name: plugin.manifest.name,
                    version: plugin.manifest.version,
                    cmdCount: await this.getModuleCount(pluginId, 'commands'),
                    eventCount: await this.getModuleCount(pluginId, 'events'),
                    routeCount: await this.getModuleCount(pluginId, 'routes')
                });
            }
        }
        return this.replyContainer(interaction, success, this.t('commands.admin.titles.plugin'), details);
    }

    private async handleCache(interaction: ChatInputCommandInteraction): Promise<void> {
        const target = interaction.options.getString('target', true).toLowerCase();
        let success = false;
        let details = '';
        switch (target) {
            case 'cross-guild':
                CrossGuildResolver.clearCache();
                success = true;
                details = this.t('commands.admin.cache.popped', { target });
                break;
            case 'help-menu':
                HelpUtils.clearCache();
                success = true;
                details = this.t('commands.admin.cache.popped', { target });
                break;
            default:
                details = this.t('commands.admin.cache.unknown', { target });
        }
        return this.replyContainer(interaction, success, this.t('commands.admin.titles.cache'), details);
    }

    private async handleGate(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        if (!guildGate.isReady()) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.notReady')
            );
        }

        if (sub === 'gate-guild-block') {
            const guildId = this.resolveGuildId(interaction);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const reason = interaction.options.getString('reason');
            await guildGate.blockGuild(guildId, interaction.user.id, reason);
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.guildBlocked', { guild: guildId, reason: reason ?? '—' })
            );
        }

        if (sub === 'gate-guild-unblock') {
            const guildId = this.resolveGuildId(interaction);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const ok = await guildGate.unblockGuild(guildId);
            return this.replyContainer(
                interaction,
                ok,
                this.t('commands.admin.titles.gate'),
                ok
                    ? this.t('commands.admin.gate.guildUnblocked', { guild: guildId })
                    : this.t('commands.admin.gate.guildNotBlocked', { guild: guildId })
            );
        }

        if (sub === 'gate-guild-list') {
            const rows = await guildGate.listBlockedGuilds();
            const body =
                rows.length === 0
                    ? this.t('commands.admin.gate.listEmpty')
                    : rows
                          .slice(0, 25)
                          .map(r => `> \`${r.guildId}\`${r.reason ? ` — ${r.reason}` : ''}`)
                          .join('\n');
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.guildListHeader', { count: rows.length }) + '\n' + body
            );
        }

        if (sub === 'gate-plugin-block') {
            const guildId = this.resolveGuildId(interaction);
            const pluginId = interaction.options.getString('plugin', true);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const reason = interaction.options.getString('reason');
            await guildGate.blockPlugin(guildId, pluginId, interaction.user.id, reason);
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.pluginBlocked', {
                    plugin: pluginId,
                    guild: guildId,
                    reason: reason ?? '—'
                })
            );
        }

        if (sub === 'gate-plugin-unblock') {
            const guildId = this.resolveGuildId(interaction);
            const pluginId = interaction.options.getString('plugin', true);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const ok = await guildGate.unblockPlugin(guildId, pluginId);
            return this.replyContainer(
                interaction,
                ok,
                this.t('commands.admin.titles.gate'),
                ok
                    ? this.t('commands.admin.gate.pluginUnblocked', { plugin: pluginId, guild: guildId })
                    : this.t('commands.admin.gate.pluginNotBlocked', { plugin: pluginId, guild: guildId })
            );
        }

        if (sub === 'gate-plugin-list') {
            const guildId = interaction.options.getString('guild') || undefined;
            const rows = await guildGate.listBlockedPlugins(guildId);
            const body =
                rows.length === 0
                    ? this.t('commands.admin.gate.listEmpty')
                    : rows
                          .slice(0, 25)
                          .map(
                              r =>
                                  `> \`${r.pluginId}\` @ \`${r.guildId}\`${r.reason ? ` — ${r.reason}` : ''}`
                          )
                          .join('\n');
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.pluginListHeader', { count: rows.length }) + '\n' + body
            );
        }
    }

    private formatGrid(items: string[], columns: number = 3): string {
        if (!items?.length) return '> *None*';
        const rows: string[] = [];
        for (let i = 0; i < items.length; i += columns) {
            rows.push('> ' + items.slice(i, i + columns).map(item => `\`${item}\``).join(' • '));
        }
        return rows.join('\n');
    }

    private async getModuleCount(pluginId: string, folder: string): Promise<number> {
        try {
            const dir = path.join(process.cwd(), 'plugins', pluginId, 'src', folder);
            const files = await fs.readdir(dir, { withFileTypes: true });
            return files.filter(f => f.isFile() && (f.name.endsWith('.js') || f.name.endsWith('.ts'))).length;
        } catch {
            return 0;
        }
    }

    private async replyContainer(
        interaction: ChatInputCommandInteraction,
        success: boolean,
        title: string,
        details: string
    ): Promise<void> {
        const layoutKey = success ? 'layouts.containerSuccess' : 'layouts.containerError';
        const rawJson = this.t(layoutKey, { title });
        const layout: Cv2LayoutSpec = JSON.parse(rawJson);
        const container = layout.components[0] as any;
        if (container?.children?.[2]) container.children[2].content = details;
        await interaction.editReply(buildComponentsV2(layout));
    }

    public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const sub = interaction.options.getSubcommand(true);
        const focused = interaction.options.getFocused(true);
        const q = focused.value.toLowerCase();
        let choices: string[] = [];

        try {
            if (sub === 'reload-config' && focused.name === 'file') {
                const configDir = path.join(process.cwd(), 'configuration');
                const files = await fs.readdir(configDir).catch(() => []);
                choices = files.filter(f => f.endsWith('.json5')).map(f => f.replace('.json5', ''));
                choices.unshift('all');
            } else if (sub === 'reload-lang' && focused.name === 'namespace') {
                const langDir = path.join(process.cwd(), 'configuration', 'lang');
                const files = await fs.readdir(langDir).catch(() => []);
                choices = Array.from(new Set(files.map(f => f.split('_')[0])));
                choices.unshift('all');
            } else if (
                (sub === 'reload-plugin' || sub === 'gate-plugin-block' || sub === 'gate-plugin-unblock') &&
                focused.name === 'id' || focused.name === 'plugin'
            ) {
                const pluginsDir = path.join(process.cwd(), 'plugins');
                const entries = await fs.readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
                choices = entries.filter(e => e.isDirectory()).map(e => e.name);
            } else if (sub === 'cache-pop' && focused.name === 'target') {
                choices = this.KNOWN_CACHES;
            }
        } catch {
            /* ignore */
        }

        await interaction.respond(
            choices
                .filter(c => c.toLowerCase().includes(q))
                .slice(0, 25)
                .map(c => ({ name: c, value: c }))
        );
    }
}
