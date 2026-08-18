import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';

export default class PermissionsPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id: 'permissions',
        name: 'Permissions Manager',
        version: '1.1.0',
        description: 'Admin commands for managing the bot permission system.',
        author: 'Lunedusk',
        dependencies: [],
        novax_version: '>=0.2.0',
        priority: -10,
    };

    public async onSetup(): Promise<void> {
        this.log.info('Permissions plugin setting up.');
    }

    public async onEnable(): Promise<void> {
        this.log.info('Permissions plugin is live.');
    }

    public async onDisable(): Promise<void> {
        this.log.info('Permissions plugin shutting down.');
    }
}
