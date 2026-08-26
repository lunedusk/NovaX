import { BaseHandler } from '#core/bases/Handler.js';
import { cmdCounterCollection } from '../lib/db.js';

export default class DashboardAnalyticsHandler extends BaseHandler {
    public readonly name = 'analytics';
    public readonly version = '1.0.0';
    public readonly description = 'Records command execution counters for dashboard analytics.';

    public async recordCommand(pluginId: string, commandName: string): Promise<void> {
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const col = await cmdCounterCollection(this.heart);
        const id = `cmd_${date}_${pluginId}_${commandName}`;
        const existing = await col.get(id).catch(() => null);
        await col.upsert({
            _id: id,
            date,
            pluginId,
            commandName,
            count: ((existing?.count as number) ?? 0) + 1,
        });
    }
}
