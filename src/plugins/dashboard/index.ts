import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { CUSTOM_BITS_TO_REGISTER } from './src/lib/bits.js';
import type PermissionsHandler from '../permissions/src/handlers/manager.js';
import type DashboardAnalyticsHandler from './src/handlers/analytics.js';

export default class DashboardPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id: 'dashboard',
        name: 'Dashboard API',
        version: '1.0.0',
        description: 'REST API surface consumed by the web dashboard.',
        dependencies: ['dash-data', 'api', 'permissions', 'token'],
        priority: 10,
    };

    public async onSetup(): Promise<void> {
        const perms = this.heart.system.handler.$get('permissions', 'manager') as PermissionsHandler | undefined;
        if (perms) {
            for (const { bit, description } of CUSTOM_BITS_TO_REGISTER) {
                await perms.registerBit(bit, description, this.heart.id);
            }
            this.log.info(`Registered ${CUSTOM_BITS_TO_REGISTER.length} custom dashboard permission bit(s).`);
        } else {
            this.log.warn('permissions handler unavailable during onSetup — custom bits were not registered.');
        }
    }

    public async onEnable(): Promise<void> {
        this.log.info('Dashboard API is live.');

        try {
            this.heart.system.events.on(
                'command:executed',
                (payload: { pluginId: string; commandName: string }) => {
                    const analytics = this.heart.system.handler.$get('dashboard', 'analytics') as
                        | DashboardAnalyticsHandler
                        | undefined;
                    void analytics?.recordCommand(payload.pluginId, payload.commandName);
                },
            );
        } catch (e) {
            this.log.debug(`command:executed event not available — analytics will rely on direct handler calls. (${(e as Error).message})`);
        }
    }

    public async onDisable(): Promise<void> {
        this.log.info('Dashboard API shutting down.');
    }
}
