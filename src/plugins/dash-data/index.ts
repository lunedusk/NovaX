import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';

export default class DashDataPlugin extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'dash-data',
        name: 'Dashboard Data',
        version: '1.0.0',
        description:
            'Owns all dashboard persistence (dash_* tables, layouts, KV, surface flags). HTTP surface remains on the dashboard plugin.',
        author: 'Lunedusk',
        dependencies: [],
        novax_version: '>=0.3.0',
        priority: -5,
    };

    public async onSetup(): Promise<void> {
        this.log.info('dash-data store ready (persistence owner).');
    }

    public async onEnable(): Promise<void> {
        this.log.info('dash-data plugin enabled.');
    }

    public async onDisable(): Promise<void> {
        this.log.info('dash-data plugin shutting down.');
    }
}
