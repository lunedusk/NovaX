import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';

export default class PermissionsPlugin extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'permissions',
        name: 'Permissions',
        version: '0.1.0',
        author: 'Lunedusk',
        novax_version: '>=0.1.0'
    };

    public async onSetup(): Promise<void> {
        const rawConfig = this.heart.assets.config.get('permissions');

        if (!rawConfig) {
            this.log.warn('No permissions.json5 found. Permission gating will remain permissive until configured.');
            return;
        }

        const levels = Object.keys((rawConfig as { levels?: Record<string, unknown> }).levels ?? {});
        this.log.info(`Loaded permissions configuration with ${levels.length} level(s).`);
    }

    public async onEnable(): Promise<void> {
        this.log.info('Permissions plugin is online.');
    }
}