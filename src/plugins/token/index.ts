import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';

import { featureRequirements } from '#core/manager/featureRequirements.js';

export default class TokenPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id: 'token',
        name: 'Token Manager',
        version: '1.2.0',
        description: 'HMAC-SHA256 bearer token management with REST API.',
        author: 'Lunedusk',
        dependencies: ['api'],
        zene_version: '>=0.5.4',
        node_version: '>=20',
        priority: -5,
    };

    public async onSetup(): Promise<void> {
        this.registerTokenFeatureRequirements();
        this.log.info('Token plugin setting up.');
    }

    public async onEnable(): Promise<void> {
        this.log.info('Token plugin is live.');
    }

    public async onDisable(): Promise<void> {
        this.log.info('Token plugin shutting down.');
    }
    private registerTokenFeatureRequirements(): void {
        featureRequirements.register({
            id: 'token.manager',
            pluginId: 'token',
            description: 'API token issue / rotate / revoke',
            permissions: [],
        });
    }
}
