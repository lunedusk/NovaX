import {
    type Interaction,
    MessageFlags,
    PermissionsBitField,
    type PermissionResolvable,
    type InteractionReplyOptions
} from 'discord.js';

import { buildComponentsV2Strict, type Cv2LayoutSpec } from '#core/builders/index.js';
import { resolveGlobalPlaceholders } from '#core/builders/helpers/string.js';
import { configManager } from '#core/manager/config.js';
import { emojis } from '#core/manager/emoji.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('PermissionsManager');

export interface PermissionLevelRule {
    readonly label?: string;
    readonly denyMessage?: string;
    readonly discordPermissions?: PermissionResolvable[];
    readonly clientPermissions?: PermissionResolvable[];
    readonly userIds?: string[];
    readonly roleIds?: string[];
    readonly allowInDm?: boolean;
}

export interface RouteAccessConfig {
    readonly permissionLevel?: string;
    readonly roleIds?: string[];
    readonly userIds?: string[];
    readonly userPermissions?: PermissionResolvable[];
    readonly clientPermissions?: PermissionResolvable[];
    readonly allowInDm?: boolean;
    readonly denyMessage?: string;
}

export interface PermissionsConfig {
    readonly enabled?: boolean;
    readonly defaultLevel?: string;
    readonly levels?: Record<string, PermissionLevelRule>;
}

interface PermissionCheckResult {
    allowed: boolean;
    reason: string;
    hideable: boolean;
}

export class PermissionsManager {
    private get config(): PermissionsConfig | null {
        return configManager.get<PermissionsConfig>('permissions');
    }

    public applyCommandDefaults(commandData: any, access?: string | RouteAccessConfig): void {
        const normalized = this.normalizeAccess(access);
        const rule = this.resolveRule(normalized.permissionLevel);

        const memberPermissions = [
            ...(normalized.userPermissions ?? []),
            ...(rule?.discordPermissions ?? [])
        ];

        if (memberPermissions.length && typeof commandData?.setDefaultMemberPermissions === 'function') {
            const bitfield = new PermissionsBitField(memberPermissions).bitfield;
            commandData.setDefaultMemberPermissions(bitfield);
        }

        const guildOnly = Boolean(
            normalized.roleIds?.length ||
            normalized.userIds?.length ||
            normalized.userPermissions?.length ||
            normalized.clientPermissions?.length ||
            rule?.roleIds?.length ||
            rule?.userIds?.length ||
            rule?.discordPermissions?.length ||
            rule?.clientPermissions?.length
        );

        if (guildOnly && typeof commandData?.setDMPermission === 'function') {
            commandData.setDMPermission(false);
        }
    }

    public canExecute(interaction: Interaction, access?: string | RouteAccessConfig): PermissionCheckResult {
        const normalized = this.normalizeAccess(access);
        const directCheck = this.checkRequirements(interaction, {
            userPermissions: normalized.userPermissions,
            clientPermissions: normalized.clientPermissions,
            roleIds: normalized.roleIds,
            userIds: normalized.userIds,
            allowInDm: normalized.allowInDm,
            denyMessage: normalized.denyMessage
        });

        if (!directCheck.allowed) {
            return directCheck;
        }

        const cfg = this.config;

        if (!cfg || cfg.enabled === false || !cfg.levels || Object.keys(cfg.levels).length === 0) {
            return { allowed: true, reason: '', hideable: false };
        }

        const explicitLevel = typeof normalized.permissionLevel === 'string' && normalized.permissionLevel.trim().length > 0;
        const effectiveLevel = explicitLevel ? normalized.permissionLevel.trim() : (cfg.defaultLevel ?? 'public');

        if (effectiveLevel === 'public' && !explicitLevel) {
            return { allowed: true, reason: '', hideable: false };
        }

        const rule = this.resolveRule(effectiveLevel);

        if (!rule) {
            if (!explicitLevel && effectiveLevel === 'public') {
                return { allowed: true, reason: '', hideable: false };
            }

            return {
                allowed: false,
                reason: `Permission level '${effectiveLevel}' is not configured.`,
                hideable: false
            };
        }

        const levelCheck = this.checkRequirements(interaction, {
            userPermissions: rule.discordPermissions,
            clientPermissions: rule.clientPermissions,
            roleIds: rule.roleIds,
            userIds: rule.userIds,
            allowInDm: rule.allowInDm,
            denyMessage: rule.denyMessage
        });

        return levelCheck.allowed
            ? { allowed: true, reason: '', hideable: false }
            : levelCheck;
    }

    public async sendDenied(interaction: Interaction, reason: string): Promise<void> {
        if (interaction.isAutocomplete()) {
            await interaction.respond([]).catch(() => {});
            return;
        }

        if (!interaction.isRepliable()) {
            return;
        }

        const payload = this.buildDeniedPayload(resolveGlobalPlaceholders(reason));

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply(payload);
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Failed to send permission denial: ${err.message}`);
        }
    }

    private normalizeAccess(access?: string | RouteAccessConfig): RouteAccessConfig {
        if (typeof access === 'string') {
            return { permissionLevel: access };
        }

        return access ?? {};
    }

    private resolveRule(permissionLevel?: string): PermissionLevelRule | null {
        const cfg = this.config;

        if (!cfg?.enabled) {
            return null;
        }

        if (!cfg.levels || Object.keys(cfg.levels).length === 0) {
            return null;
        }

        const levels = cfg.levels ?? {};
        const levelName = typeof permissionLevel === 'string' && permissionLevel.trim().length > 0
            ? permissionLevel.trim()
            : (cfg.defaultLevel ?? 'public');

        return levels[levelName] ?? null;
    }

    private checkRequirements(interaction: Interaction, access: RouteAccessConfig): PermissionCheckResult {
        if (access.userPermissions?.length) {
            const memberPermissions = interaction.memberPermissions;

            if (!memberPermissions) {
                return {
                    allowed: false,
                    reason: access.denyMessage ?? 'You need additional Discord permissions to use this.',
                    hideable: true
                };
            }

            const requiredPermissions = new PermissionsBitField(access.userPermissions).bitfield;

            if (!memberPermissions.has(requiredPermissions)) {
                return {
                    allowed: false,
                    reason: access.denyMessage ?? 'You do not have the required Discord permissions.',
                    hideable: true
                };
            }
        }

        if (access.clientPermissions?.length) {
            const appPermissions = interaction.appPermissions;

            if (!appPermissions) {
                return {
                    allowed: false,
                    reason: access.denyMessage ?? 'I cannot verify my own Discord permissions in this channel.',
                    hideable: false
                };
            }

            const requiredPermissions = new PermissionsBitField(access.clientPermissions).bitfield;

            if (!appPermissions.has(requiredPermissions)) {
                return {
                    allowed: false,
                    reason: access.denyMessage ?? 'I do not have the required Discord permissions in this channel.',
                    hideable: false
                };
            }
        }

        if (access.roleIds?.length) {
            if (!interaction.inGuild()) {
                return {
                    allowed: false,
                    reason: access.denyMessage ?? 'This command can only be used in a server.',
                    hideable: false
                };
            }

            const memberRoleIds = this.getMemberRoleIds(interaction.member);

            if (!memberRoleIds.some(roleId => access.roleIds!.includes(roleId))) {
                return {
                    allowed: false,
                    reason: access.denyMessage ?? 'You do not have one of the required roles to use this.',
                    hideable: false
                };
            }
        }

        if (access.userIds?.length && !access.userIds.includes(interaction.user.id)) {
            return {
                allowed: false,
                reason: access.denyMessage ?? 'You are not allowed to use this interaction.',
                hideable: false
            };
        }

        if (access.allowInDm === false && !interaction.inGuild()) {
            return {
                allowed: false,
                reason: access.denyMessage ?? 'This interaction cannot be used in DMs.',
                hideable: false
            };
        }

        return { allowed: true, reason: '', hideable: false };
    }

    private getMemberRoleIds(member: Interaction['member']): string[] {
        if (!member || typeof member !== 'object') {
            return [];
        }

        if ('roles' in member) {
            const memberRoles = (member as { roles?: { cache?: Map<string, unknown> } | string[] }).roles;

            if (Array.isArray(memberRoles)) {
                return memberRoles;
            }

            if (memberRoles?.cache) {
                return Array.from(memberRoles.cache.keys());
            }
        }

        return [];
    }

    private buildDeniedPayload(reason: string): InteractionReplyOptions {
        const cross = emojis.get('cross') || '❌';

        const layout: Cv2LayoutSpec = {
            version: 1,
            components: [
                {
                    type: 'container',
                    accentColor: 0xE74C3C,
                    children: [
                        {
                            type: 'text',
                            content: `## ${cross} Access denied`
                        },
                        {
                            type: 'separator',
                            divider: true,
                            spacing: 'large'
                        },
                        {
                            type: 'text',
                            content: resolveGlobalPlaceholders(reason)
                        }
                    ]
                }
            ]
        };

        const built = buildComponentsV2Strict(layout);

        return {
            flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2],
            components: built.components
        };
    }
}

export const permissionsManager = new PermissionsManager();