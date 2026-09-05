import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';

import { featureRequirements } from '#core/manager/featureRequirements.js';
import { PermissionFlagsBits } from 'discord.js';

export default class PermissionsPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id: 'permissions',
        name: 'Permissions Manager',
        version: '1.2.0',
        description: 'Admin commands for managing the bot permission system.',
        author: 'Lunedusk',
        dependencies: [],
        zene_version: '>=0.5.4',
        node_version: '>=20',
        priority: -10,
    };

    public async onSetup(): Promise<void> {
        this.registerPermissionsFeatureRequirements();
        this.log.info('Permissions plugin setting up.');
    }

    public async onEnable(): Promise<void> {
        try {
            const bits = await this.heart.permissions.listBits();
            this.log.info(`Permissions plugin is live. Catalogue size: ${bits.length}`);
        } catch (err) {
            this.log.info('Permissions plugin is live.');
            this.log.debug(`Catalogue list skipped: ${(err as Error).message}`);
        }
    }

    public async onDisable(): Promise<void> {
        this.log.info('Permissions plugin shutting down.');
    }
    private registerPermissionsFeatureRequirements(): void {
        featureRequirements.register({
            id: 'permissions.discordRoleSync',
            pluginId: 'permissions',
            description: 'Discord role → permission bit sync',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ViewChannel],
        });
        featureRequirements.register({
            id: 'permissions.hierarchy',
            pluginId: 'permissions',
            description: 'Permission hierarchy checks',
            permissions: [],
        });
        featureRequirements.register({
            id: 'permissions.mirror',
            pluginId: 'permissions',
            description: 'Per-guild Discord permission mirror',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ViewChannel],
        });
    }
}
