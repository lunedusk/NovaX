import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';

import { registerPermissionsFeatureRequirements } from '#core/manager/featureRequirements.js';

export default class PermissionsPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id: 'permissions',
        name: 'Permissions Manager',
        version: '1.1.0',
        description: 'Admin commands for managing the bot permission system.',
        author: 'Lunedusk',
        dependencies: [],
        zene_version: '>=0.5.2',
        priority: -10,
    };

    public async onSetup(): Promise<void> {
        registerPermissionsFeatureRequirements();
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
}
