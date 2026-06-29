import { BaseHandler } from '#core/bases/Handler.js';
import { type Router } from 'express';
import { GatewayConfigManager } from '../lib/GatewayConfigManager.js';

export default class GatewayManager extends BaseHandler {

    public readonly name        = 'manager';
    public readonly version     = '1.0.0';
    public readonly description = 'Public API surface for the API Gateway plugin — the single entry point for sibling plugins.';

    private get gateway() { return GatewayConfigManager.instance; }

    public async onInitialize(): Promise<void> {
        this.log.info('GatewayManager handler ready.');
    }

    public async onTeardown(): Promise<void> {
        this.log.info('GatewayManager handler torn down.');
    }

    public applyMiddleware(router: Router): void {
        this.gateway.applyMiddleware(router);
    }

    public buildOpenApiSpec(baseUrl: string): Record<string, unknown> {
        return this.gateway.buildOpenApiSpec(baseUrl);
    }

    public getCorsConfig(): Readonly<Record<string, unknown>> {
        return this.gateway.cors;
    }

    public isOriginAllowed(origin: string): boolean {
        return this.gateway.isOriginAllowed(origin);
    }

    public getAuthStatus(): { enabled: boolean; keyCount: number; publicPaths: string[] } {
        const cfg = this.gateway.auth;
        return {
            enabled:     cfg.enabled,
            keyCount:    cfg.keys.filter(k => k.enabled).length,
            publicPaths: cfg.publicPaths,
        };
    }

    public validateKey(key: string): boolean {
        return this.gateway.isValidKey(key);
    }
}
