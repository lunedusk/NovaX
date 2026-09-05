import { eventBus } from '#core/manager/events/EventBus.js';
import { getLogger } from '#core/utils/logger.js';
import { REGISTRY_EVENT } from './dashRegistry.js';
import type { Response } from 'express';

const log = getLogger('DashEvents');

export type DashSseEventType =
    | 'registry.updated'
    | 'surface.invalidate'
    | 'theme.updated'
    | 'layout.updated'
    | 'widget.data'
    | 'heartbeat';

export interface DashSsePayload {
    type: DashSseEventType;
    version?: number;
    reason?: string;
    pluginId?: string;
    surfaceId?: string;
    scope?: string;
    guildId?: string;
    payload?: unknown;
    at: number;
}

interface SseClient {
    id: string;
    res: Response;
    userId: string;
    bits: ReadonlySet<string>;
    isEnvOwner: boolean;
}

const clients = new Map<string, SseClient>();
let wired = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function writeEvent(res: Response, event: DashSsePayload): boolean {
    try {
        if (res.writableEnded) return false;
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        return true;
    } catch {
        return false;
    }
}

export function broadcastDashEvent(event: Omit<DashSsePayload, 'at'> & { at?: number }): void {
    const full: DashSsePayload = { ...event, at: event.at ?? Math.floor(Date.now() / 1000) };
    for (const [id, client] of clients) {
        if (!writeEvent(client.res, full)) {
            clients.delete(id);
        }
    }
}

export function addSseClient(client: SseClient): () => void {
    clients.set(client.id, client);
    writeEvent(client.res, {
        type: 'heartbeat',
        at: Math.floor(Date.now() / 1000),
        reason: 'connected',
    });
    return () => {
        clients.delete(client.id);
    };
}

export function ensureDashEventWiring(): void {
    if (wired) return;
    wired = true;

    eventBus.on(REGISTRY_EVENT, (raw: unknown) => {
        const payload = (raw ?? {}) as { version?: number; reason?: string };
        broadcastDashEvent({
            type: 'registry.updated',
            version: payload?.version,
            reason: payload?.reason,
        });
    });

    eventBus.on('dash.surface.invalidate', (raw: unknown) => {
        const payload = (raw ?? {}) as { pluginId?: string; surfaceId?: string };
        broadcastDashEvent({
            type: 'surface.invalidate',
            pluginId: payload?.pluginId,
            surfaceId: payload?.surfaceId,
        });
    });

    eventBus.on('dash.theme.updated', () => {
        broadcastDashEvent({ type: 'theme.updated' });
    });

    eventBus.on('dash.layout.updated', (raw: unknown) => {
        const payload = (raw ?? {}) as { scope?: string; guildId?: string };
        broadcastDashEvent({
            type: 'layout.updated',
            scope: payload?.scope,
            guildId: payload?.guildId,
        });
    });

    eventBus.on(
        'dash.widget.data',
        (raw: unknown) => {
            const payload = (raw ?? {}) as { pluginId?: string; surfaceId?: string; payload?: unknown };
            broadcastDashEvent({
                type: 'widget.data',
                pluginId: payload?.pluginId,
                surfaceId: payload?.surfaceId,
                payload: payload?.payload,
            });
        },
    );

    heartbeatTimer = setInterval(() => {
        broadcastDashEvent({ type: 'heartbeat' });
    }, 25_000);
    if (typeof heartbeatTimer === 'object' && 'unref' in heartbeatTimer) {
        heartbeatTimer.unref();
    }

    log.info('Dash SSE event wiring active');
}

export function sseClientCount(): number {
    return clients.size;
}

export function emitRegistryUpdatedForTests(version: number, reason: string): void {
    void eventBus.emit(REGISTRY_EVENT, { version, reason });
}
