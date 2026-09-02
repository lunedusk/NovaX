import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { ErrorReporterService } from './src/utils/errorReporterService.js';

const SERVICE_KEY = Symbol.for('novax.error-reporter.service');

export default class ErrorReporterPlugin extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'error-reporter',
        name: 'Error Reporter',
        version: '1.3.0',
        description: 'Forwards log.error and unhandled process errors to Discord.',
        author: 'NovaX',
        zene_version: '>=0.5.2',
        node_version: '>=20',
    };

    public async onSetup(): Promise<void> {
        const service = new ErrorReporterService(this.heart);
        await service.init();
        
        (globalThis as any)[SERVICE_KEY] = service;
        this.log.info('ErrorReporter service initialised.');
    }

    public async onEnable(): Promise<void> {
        this.log.info('Error Reporter is live and listening via autoloaded events.');
    }

    public async onDisable(): Promise<void> {
        const service = (globalThis as any)[SERVICE_KEY];
        if (service) {
            await service.destroy();
            delete (globalThis as any)[SERVICE_KEY];
        }
        this.log.info('Error Reporter shut down.');
    }
}