import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { featureRequirements } from '#core/manager/featureRequirements.js';

export default class DashDataPlugin extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'dash-data',
        name: 'Dashboard Data',
        version: '1.2.0',
        description:
            'Owns all dashboard persistence (dash_* tables, layouts, KV, surface flags). HTTP surface remains on the dashboard plugin.',
        author: 'Lunedusk',
        dependencies: [],
        zene_version: '>=0.5.4',
        node_version: '>=20',
        priority: -5,
    };

    public async onSetup(): Promise<void> {
        this.registerDashDataFeatureRequirements();
        this.log.info('dash-data store ready (persistence owner).');
    }

    public async onEnable(): Promise<void> {
        this.log.info('dash-data plugin enabled.');
    }

    public async onDisable(): Promise<void> {
        this.log.info('dash-data plugin shutting down.');
    }
    private registerDashDataFeatureRequirements(): void {
        featureRequirements.register({
            id: 'dash-data.store',
            pluginId: 'dash-data',
            description: 'Dashboard data store',
            permissions: [],
        });
    }
}
