import { BasePlugin, type PluginManifest } from '../../core/bases/Plugin.js';

export interface SellAuthConfig {
    enabled: boolean;
    shopId: string;
    webhookSecret: string;
    sellauthApiKey: string;
    reviewChannel: string;
    guild: string;
    notificationChannel: string;
    roles: {
        customer: string;
        admin: string;
    };
    features: {
        autoDMInstructions: boolean;
    };
}

export default class SellauthPlugin extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'sellauth',
        name: 'SellAuth',
        version: '0.1.0',
        author: 'NovaCore Development',
        novax_version: '>=0.1.0',
        node_version: '>=18.20.8',
        dependencies: ['core']
    };
    private config!: SellAuthConfig;
    public async onSetup(): Promise<void> {
        const rawConfig = (this as any).heart?.assets?.config?.get('sellauth');
        
        if (!rawConfig) {
            this.log.warn('No sellauth.json5 found');
            this.config = {
                enabled: false,
                shopId: '',
                webhookSecret: '',
                sellauthApiKey: '',
                reviewChannel: '',
                guild: '',
                notificationChannel: '',
                roles: {
                    customer: '',
                    admin: ''
                },
                features: {
                    autoDMInstructions: false
                }
            };
            return;
        }

        this.config = rawConfig as SellAuthConfig;
    }

    public async onEnable(): Promise<void> {
        
    }

    public async onDisable(): Promise<void> {
        
    }
}