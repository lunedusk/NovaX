import { BaseHandler } from '#core/bases/Handler.js';
import type { SqlAdapter, Row } from '#core/database/sqlAdapter.js';
import type { IHeart } from '#core/heart/index.js';
import * as store from '../lib/store.js';
import type { DashLayoutDoc, LayoutScope } from '../lib/store.js';

export default class DashDataStoreHandler extends BaseHandler {
    public readonly name = 'store';
    public readonly version = '1.0.0';
    public readonly description = 'Dashboard persistence API (tables, KV, layouts, theme, flags).';

    public async onInitialize(): Promise<void> {
        await store.ensureDashboardAdapter();
        this.log.info('dash-data store handler ready.');
    }

    public async onTeardown(): Promise<void> {
        store.resetDashDataAdapterCache();
        this.log.info('dash-data store handler torn down.');
    }

    public async getAdapter(): Promise<SqlAdapter> {
        return store.ensureDashboardAdapter();
    }

    public async get(sql: string, params?: unknown[]): Promise<Row | null> {
        return store.dashGet(sql, params);
    }

    public async all(sql: string, params?: unknown[]): Promise<Row[]> {
        return store.dashAll(sql, params);
    }

    public async run(sql: string, params?: unknown[]): Promise<void> {
        return store.dashRun(sql, params);
    }

    public async mongo(name: string) {
        return store.dashMongo(name);
    }

    public async isGloballyBanned(userId: string): Promise<boolean> {
        return store.isGloballyBanned(this.heart, userId);
    }

    public async banGlobal(userId: string, reason: string | undefined, bannedBy: string): Promise<void> {
        return store.banGlobal(this.heart, userId, reason, bannedBy);
    }

    public async unbanGlobal(userId: string): Promise<void> {
        return store.unbanGlobal(this.heart, userId);
    }

    public async getServerPluginConfig(guildId: string, pluginId: string): Promise<Record<string, unknown>> {
        return store.getServerPluginConfig(this.heart, guildId, pluginId);
    }

    public async setServerPluginConfig(
        guildId: string,
        pluginId: string,
        config: Record<string, unknown>,
    ): Promise<void> {
        return store.setServerPluginConfig(this.heart, guildId, pluginId, config);
    }

    public async kvGet(ns: string, key: string): Promise<unknown | null> {
        return store.kvGet(ns, key);
    }

    public async kvSet(ns: string, key: string, value: unknown): Promise<void> {
        return store.kvSet(ns, key, value);
    }

    public async kvDel(ns: string, key: string): Promise<void> {
        return store.kvDel(ns, key);
    }

    public async getLayout(scope: LayoutScope, guildId?: string): Promise<DashLayoutDoc | null> {
        return store.getLayout(scope, guildId);
    }

    public async putLayout(doc: DashLayoutDoc): Promise<void> {
        return store.putLayout(doc);
    }

    public async getTheme(): Promise<{ tokens: Record<string, unknown>; updatedAt: number }> {
        return store.getTheme();
    }

    public async putTheme(tokens: Record<string, unknown>): Promise<void> {
        return store.putTheme(tokens);
    }

    public async getSurfaceFlag(
        pluginId: string,
        surfaceId: string,
    ): Promise<{ enabled: boolean; updatedAt: number } | null> {
        return store.getSurfaceFlag(pluginId, surfaceId);
    }

    public async setSurfaceFlag(
        pluginId: string,
        surfaceId: string,
        enabled: boolean,
        updatedBy?: string,
    ): Promise<void> {
        return store.setSurfaceFlag(pluginId, surfaceId, enabled, updatedBy);
    }

    public async writeAudit(
        entry: {
            actorId: string;
            action: string;
            target?: string;
            guildId?: string | null;
            meta?: Record<string, unknown>;
        },
    ): Promise<void> {
        return store.writeAudit(this.heart, entry);
    }

    public heartRef(): IHeart {
        return this.heart;
    }
}
