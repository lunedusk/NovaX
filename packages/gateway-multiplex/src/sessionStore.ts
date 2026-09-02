import type { SessionInfo, SessionStore } from './types.js';

export class MemorySessionStore implements SessionStore {
    private readonly map = new Map<number, SessionInfo>();

    public get(shardId: number): SessionInfo | null {
        return this.map.get(shardId) ?? null;
    }

    public set(shardId: number, info: SessionInfo): void {
        this.map.set(shardId, info);
    }

    public delete(shardId: number): void {
        this.map.delete(shardId);
    }

    public clear(): void {
        this.map.clear();
    }
}
