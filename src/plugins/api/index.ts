import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { GatewayConfigManager, type GatewayPluginConfig } from './src/lib/GatewayConfigManager.js';
import { NovaError } from '#core/errors/NovaError.js';

export default class ApiGatewayPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id:            'api',
        name:          'API',
        version:       '0.1.0',
        description:   'API Gateway — CORS, bearer auth, security headers, and OpenAPI spec.',
        author:        'Lunedusk',
        novax_version: '>=0.2.0',
        node_version:  '>=20',
    };

    public async onSetup(): Promise<void> {
        const config = this.heart.assets.config.get<GatewayPluginConfig>('api');

        if (!config) {
            throw new NovaError('API config not found. Ensure data/configuration/config.json5 exists.', {
                code: 'GATEWAY.CONFIG_MISSING',
                category: 'gateway',
                severity: 'fatal',
                userMessage: 'API gateway configuration is missing.',
                statusCode: 500,
            });
        }

        GatewayConfigManager.instance.init(config);
        this.log.info('API Gateway config manager initialised.');
    }

    public async onEnable(): Promise<void> {
        this.log.info('API Gateway is live.');
    }

    public async onDisable(): Promise<void> {
        this.log.info('API Gateway shut down.');
    }
}
