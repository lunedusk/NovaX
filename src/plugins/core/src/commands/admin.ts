import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import {
    SlashCommandBuilder,
    AttachmentBuilder,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
    MessageFlags
} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import type { ContainerSpec } from '#core/builders/componentsv2Builder/types.js';
import { Cooldown } from '#core/decorators/cooldown.js';
import { guildGate } from '#core/manager/guildGate.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';
import { HelpUtils } from '../utils/helpUtils.js';
import { reloadEnvFromDisk } from '#core/helpers/envReload.js';
import { listRegisteredCaches, getRegisteredCache } from '#core/helpers/cache.js';
import { actorFromUser } from '#core/audit/actor.js';
import { permissionsManager } from '#core/manager/permissions.js';

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
            sub.setName('reload-env').setDescription(this.t('commands.admin.reload.envDescription'))
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
            sub.setName('cache-list').setDescription(this.t('commands.admin.cache.listDescription'))
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
        )
        .addSubcommand(sub =>
            sub
                .setName('audit-list')
                .setDescription(this.t('commands.admin.audit.listDescription'))
                .addIntegerOption(opt =>
                    opt
                        .setName('limit')
                        .setDescription(this.t('commands.admin.audit.limitDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('actor')
                        .setDescription(this.t('commands.admin.audit.actorDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('action')
                        .setDescription(this.t('commands.admin.audit.actionDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('outcome')
                        .setDescription(this.t('commands.admin.audit.outcomeDescription'))
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('audit-get')
                .setDescription(this.t('commands.admin.audit.getDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('id')
                        .setDescription(this.t('commands.admin.audit.idDescription'))
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('error-list')
                .setDescription(this.t('commands.admin.errors.listDescription'))
                .addIntegerOption(opt =>
                    opt
                        .setName('limit')
                        .setDescription(this.t('commands.admin.errors.limitDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('code')
                        .setDescription(this.t('commands.admin.errors.codeDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('category')
                        .setDescription(this.t('commands.admin.errors.categoryDescription'))
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('severity')
                        .setDescription(this.t('commands.admin.errors.severityDescription'))
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('error-get')
                .setDescription(this.t('commands.admin.errors.getDescription'))
                .addStringOption(opt =>
                    opt
                        .setName('id')
                        .setDescription(this.t('commands.admin.errors.idDescription'))
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('audit-export')
                .setDescription(this.t('commands.admin.audit.exportDescription'))
        )
        .addSubcommand(sub =>
            sub
                .setName('error-export')
                .setDescription(this.t('commands.admin.errors.exportDescription'))
        )
        .addSubcommand(sub =>
            sub
                .setName('bit-holders')
                .setDescription(this.t('commands.admin.bitHolders.description'))
                .addStringOption(opt =>
                    opt
                        .setName('bit')
                        .setDescription(this.t('commands.admin.bitHolders.bitDescription'))
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('page')
                        .setDescription(this.t('commands.admin.bitHolders.pageDescription'))
                        .setRequired(false)
                )
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: true
    };

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
        const resolved = await perms.resolve(interaction.user.id, guildId);
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
            if (sub === 'cache-list' || sub === 'cache-pop') return this.handleCache(interaction, sub);
            if (sub === 'audit-list' || sub === 'audit-get') return this.handleAudit(interaction, sub);
            if (sub === 'error-list' || sub === 'error-get' || sub === 'error-export') return this.handleErrors(interaction, sub);
            if (sub === 'audit-export') return this.handleAudit(interaction, sub);
            if (sub === 'bit-holders') return this.handleBitHolders(interaction);
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
            const manager = this.heart.assets.config;
            const success =
                !file || file === 'all' ? await manager.reloadAll() : await manager.reloadFile(file);
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.reload.config',
                target: file ?? 'all',
                outcome: success ? 'success' : 'fail',
            });
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
            const manager = this.heart.assets.lang;
            const success =
                !namespace || namespace === 'all'
                    ? await manager.reloadAll()
                    : await manager.reloadFile(namespace);
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.reload.lang',
                target: namespace ?? 'all',
                outcome: success ? 'success' : 'fail',
            });
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
                this.heart.assets.emoji;
            if (!manager) throw new Error('EmojiManager is not accessible.');
            const success = await manager.reload();
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.reload.emoji',
                target: 'emoji',
                outcome: success ? 'success' : 'fail',
            });
            const count = Object.keys(manager.getAll?.() || {}).length;
            const details = success
                ? this.t('commands.admin.reload.emojiSuccess', { count })
                : this.t('commands.admin.reload.emojiError');
            return this.replyContainer(interaction, success, this.t('commands.admin.titles.emoji'), details);
        }
        if (sub === 'reload-env') {
            try {
                const result = reloadEnvFromDisk();
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'admin.reload.env',
                    target: 'env',
                    outcome: 'success',
                    meta: { count: result.updated.length },
                });
                const details = this.t('commands.admin.reload.envSuccess', {
                    files: result.filesRead.length ? result.filesRead.join(', ') : 'none',
                    updated: String(result.updated.length),
                    skipped: String(result.skipped.length),
                    skippedList: result.skipped.length ? result.skipped.join(', ') : '—',
                });
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.env'),
                    details,
                );
            } catch (err) {
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'admin.reload.env',
                    target: 'env',
                    outcome: 'fail',
                    reason: 'error',
                });
                throw err;
            }
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
            (await import('#core/loader/index.js')).pluginManager;
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

    private async handleCache(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        if (sub === 'cache-list') {
            const listed = listRegisteredCaches();
            if (listed.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.cache'),
                    this.t('commands.admin.cache.listEmpty'),
                );
            }
            const lines = listed.map((e) =>
                this.t('commands.admin.cache.listLine', {
                    name: e.name,
                    size: String(e.size),
                }),
            );
            const details = this.t('commands.admin.cache.listHeader', {
                count: String(listed.length),
                grid: lines.join('\n'),
            });
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.cache'),
                details,
            );
        }

        const target = interaction.options.getString('target', true).trim();
        const cache = getRegisteredCache(target);
        if (!cache) {
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.cache.pop',
                target,
                outcome: 'fail',
                reason: 'unknown_cache',
            });
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.cache'),
                this.t('commands.admin.cache.unknown', { target }),
            );
        }
        cache.clear();
        void this.heart.system.audit.record({
            ...actorFromUser(interaction.user.id),
            action: 'admin.cache.pop',
            target,
            outcome: 'success',
            meta: { cacheName: target },
        });
        return this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.cache'),
            this.t('commands.admin.cache.popped', { target }),
        );
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
            try {
                await guildGate.blockGuild(guildId, interaction.user.id, reason);
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.guild.block',
                    target: guildId,
                    outcome: 'success',
                    reason: reason ?? undefined,
                });
            } catch (err) {
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.guild.block',
                    target: guildId,
                    outcome: 'fail',
                    reason: 'error',
                });
                throw err;
            }
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
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'gate.guild.unblock',
                target: guildId,
                outcome: ok ? 'success' : 'fail',
                reason: ok ? undefined : 'not_blocked',
            });
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
            try {
                await guildGate.blockPlugin(guildId, pluginId, interaction.user.id, reason);
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.plugin.block',
                    target: pluginId,
                    outcome: 'success',
                    reason: reason ?? undefined,
                    meta: { guildId },
                });
            } catch (err) {
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.plugin.block',
                    target: pluginId,
                    outcome: 'fail',
                    reason: 'error',
                    meta: { guildId },
                });
                throw err;
            }
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
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'gate.plugin.unblock',
                target: pluginId,
                outcome: ok ? 'success' : 'fail',
                reason: ok ? undefined : 'not_blocked',
                meta: { guildId },
            });
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



    private async handleErrors(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        if (sub === 'error-list') {
            const limit = 10;
            const code = interaction.options.getString('code') ?? undefined;
            const category = interaction.options.getString('category') ?? undefined;
            const severity = interaction.options.getString('severity') ?? undefined;
            const entries = await this.heart.system.errors.list({
                code,
                category,
                severity,
                limit,
            });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.errors'),
                    this.t('commands.admin.errors.listEmpty'),
                );
            }
            const lines = entries.map(e =>
                this.t('commands.admin.errors.listLine', {
                    id: e.id,
                    code: e.code,
                    count: e.count,
                    severity: e.severity,
                    category: e.category,
                    firstSeen: String(e.firstSeen),
                    lastSeen: String(e.lastSeen),
                }),
            );
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.errors'),
                this.t('commands.admin.errors.listHeader', {
                    count: entries.length,
                    grid: lines.join('\n'),
                }),
            );
        }

        if (sub === 'error-export') {
            const entries = await this.heart.system.errors.list({ limit: 100_000 });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.errors'),
                    this.t('commands.admin.errors.exportEmpty'),
                );
            }
            const body = JSON.stringify(entries, null, 2);
            const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), {
                name: `error-export-${Date.now()}.json`,
            });
            await interaction.editReply({
                content: this.t('commands.admin.errors.exportDone', { count: entries.length }),
                files: [file],
            });
            return;
        }

        const id = interaction.options.getString('id', true).trim();
        const entry = await this.heart.system.errors.getById(id);
        if (!entry) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.errors'),
                this.t('commands.admin.errors.notFound', { id }),
            );
        }
        return this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.errors'),
            this.t('commands.admin.errors.getHeader', { id: entry.id }) +
                '\n' +
                this.t('commands.admin.errors.getBody', {
                    code: entry.code,
                    category: entry.category,
                    severity: entry.severity,
                    count: entry.count,
                    message: entry.message,
                    firstSeen: String(entry.firstSeen),
                    lastSeen: String(entry.lastSeen),
                    context: JSON.stringify(entry.context),
                }),
        );
    }

    private async handleAudit(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        if (sub === 'audit-list') {
            const limit = 10;
            const actor = interaction.options.getString('actor') ?? undefined;
            const action = interaction.options.getString('action') ?? undefined;
            const outcomeRaw = interaction.options.getString('outcome');
            const outcome =
                outcomeRaw === 'success' || outcomeRaw === 'fail' ? outcomeRaw : undefined;
            const entries = await this.heart.system.audit.list({
                actorId: actor,
                action,
                outcome,
                limit,
            });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.audit'),
                    this.t('commands.admin.audit.listEmpty'),
                );
            }
            const lines = entries.map(e =>
                this.t('commands.admin.audit.listLine', {
                    id: e.id,
                    action: e.action,
                    outcome: e.outcome,
                    actor: `${e.actorType}:${e.actorId}`,
                    target: e.target,
                    when: String(e.createdAt),
                }),
            );
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.audit'),
                this.t('commands.admin.audit.listHeader', {
                    count: entries.length,
                    grid: lines.join('\n'),
                }),
            );
        }

        if (sub === 'audit-export') {
            const entries = await this.heart.system.audit.list({ limit: 100_000 });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.audit'),
                    this.t('commands.admin.audit.exportEmpty'),
                );
            }
            const body = JSON.stringify(entries, null, 2);
            const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), {
                name: `audit-export-${Date.now()}.json`,
            });
            await interaction.editReply({
                content: this.t('commands.admin.audit.exportDone', { count: entries.length }),
                files: [file],
            });
            return;
        }

        const id = interaction.options.getString('id', true).trim();
        const entry = await this.heart.system.audit.getById(id);
        if (!entry) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.audit'),
                this.t('commands.admin.audit.notFound', { id }),
            );
        }
        const metaStr = JSON.stringify(entry.meta);
        return this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.audit'),
            this.t('commands.admin.audit.getHeader', { id: entry.id }) +
                '\n' +
                this.t('commands.admin.audit.getBody', {
                    action: entry.action,
                    outcome: entry.outcome,
                    actorType: entry.actorType,
                    actorId: entry.actorId,
                    target: entry.target,
                    reason: entry.reason ?? '—',
                    createdAt: String(entry.createdAt),
                    meta: metaStr,
                }),
        );
    }


    private async handleBitHolders(interaction: ChatInputCommandInteraction): Promise<void> {
        const bit = interaction.options.getString('bit', true).trim();
        const pageRaw = interaction.options.getInteger('page');
        const page = Math.max(1, pageRaw ?? 1);

        if (!permissionsManager) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.bitHolders'),
                this.t('commands.admin.bitHolders.unavailable'),
            );
        }

        const { botWide, byGuild } = await permissionsManager.findHoldersOfBit(bit);
        type Section = { title: string; members: string[] };
        const sections: Section[] = [];
        if (botWide.length > 0) {
            sections.push({
                title: this.t('commands.admin.bitHolders.sectionBotWide'),
                members: botWide,
            });
        }
        const guildIds = [...byGuild.keys()].sort();
        for (const gid of guildIds) {
            const members = byGuild.get(gid) ?? [];
            if (members.length === 0) continue;
            sections.push({
                title: this.t('commands.admin.bitHolders.sectionGuild', { guildId: gid }),
                members,
            });
        }

        if (sections.length === 0) {
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.bitHolders'),
                this.t('commands.admin.bitHolders.empty', { bit }),
            );
        }

        const PAGE_SIZE = 10;
        const pages: string[][] = [];
        for (const section of sections) {
            for (let i = 0; i < section.members.length; i += PAGE_SIZE) {
                const chunk = section.members.slice(i, i + PAGE_SIZE);
                const lines: string[] = [];
                if (i === 0) {
                    lines.push(`**${section.title}**`);
                } else {
                    lines.push(
                        `**${section.title}** (${this.t('commands.admin.bitHolders.continued')})`,
                    );
                }
                for (const uid of chunk) {
                    lines.push(this.t('commands.admin.bitHolders.memberLine', { userId: uid }));
                }
                pages.push(lines);
            }
        }

        const totalPages = pages.length;
        const idx = Math.min(page, totalPages) - 1;
        const body = (pages[idx] ?? []).join(
            String.fromCharCode(10),
        );
        return this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.bitHolders'),
            this.t('commands.admin.bitHolders.pageHeader', {
                bit,
                page: idx + 1,
                totalPages,
            }) +
                String.fromCharCode(10) +
                body,
        );
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
        const container = layout.components[0] as ContainerSpec;
        const detailsChild = container?.children?.[2];
        if (detailsChild && detailsChild.type === 'text') {
            detailsChild.content = details;
        }
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
                choices = listRegisteredCaches().map((e) => e.name);
            } else if (sub === 'bit-holders' && focused.name === 'bit') {
                if (permissionsManager) {
                    const bits = await permissionsManager.listBits();
                    choices = bits.map((b) => String(b._id));
                }
            }
        } catch {

        }

        await interaction.respond(
            choices
                .filter(c => c.toLowerCase().includes(q))
                .slice(0, 25)
                .map(c => ({ name: c, value: c }))
        );
    }
}
