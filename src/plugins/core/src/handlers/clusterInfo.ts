import { BaseHandler } from '#core/bases/Handler.js';

export default class ClusterInfoHandler extends BaseHandler {
    public readonly name = 'clusterInfo';
    public readonly description = 'Local and Cross-Host cluster snapshot';
    public readonly requirements = {
        modes: ['crosshost'] as const,
        mode: 'soft' as const,
    };

    public localSnapshot(): Record<string, unknown> {
        const c = this.heart.control;
        return {
            mode: c.isCrossHost() ? 'crosshost' : 'local',
            role: c.role(),
            machineId: c.machineId(),
            shards: c.shards(),
            pid: c.pid(),
            uptimeMs: c.uptimeMs(),
            peers: this.heart.crossHost.isAvailable() ? this.heart.crossHost.peers() : [],
            guilds: this.heart.client.guilds.cache.size,
        };
    }

    public async fleetSnapshot(): Promise<Record<string, unknown> | null> {
        if (!this.heart.crossHost.isAvailable()) return null;
        try {
            const { fetchClusterShards } = await import('#core/crosshost/worker/clusterClient.js');
            const dump = await fetchClusterShards();
            return {
                ...this.localSnapshot(),
                totalShards: dump.totalShards,
                generation: dump.generation,
                owners: dump.owners,
                shardToMachine: dump.shardToMachine,
                workers: dump.workers ?? [],
            };
        } catch {
            return this.localSnapshot();
        }
    }
}
