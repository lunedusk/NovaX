import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';

export default class TokenPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id: 'token',
        name: 'Token Manager',
        version: '1.0.0',
        description: 'HMAC-SHA256 bearer token management with REST API.',
        author: 'NovaX Core',
        dependencies: ['api'],
        novax_version: '>=0.1.8',
        priority: -5,
    };

    public async onSetup(): Promise<void> {
        this.log.info('Token plugin setting up.');
    }

    public async onEnable(): Promise<void> {
        this.log.info('Token plugin is live.');
    }

    public async onDisable(): Promise<void> {
        this.log.info('Token plugin shutting down.');
    }
}
