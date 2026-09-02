import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import { encodeMessage, decodeMessage } from '../protocol/codec.js';
import { channelPluginBus, channelControlShutdown } from '../protocol/channels.js';
import { pluginBusMessageSchema, controlShutdownSchema } from '../protocol/messages.js';
import type { PluginBusHandler, CrossHostBus } from '#core/heart/crossHost.js';
import { performLocalShutdown } from '#core/heart/control.js';
import { fetchPeerRoster } from '../orchestrator/peerRoster.js';

const log = getLogger('CrossHost:PluginBus');

interface PluginBusMessage {
    readonly kind: 'send' | 'request' | 'response';
    readonly channel: string;
    readonly fromMachineId: string;
    readonly toMachineId: string;
    readonly payload: unknown;
    readonly requestId?: string;
}

export async function startWorkerPluginBus(opts: {
    machineId: string;
    prefix: string;
    pub: Redis;
    sub: Redis;
    main: Redis;
    peerTtlMs?: number;
}): Promise<CrossHostBus> {
    const handlers = new Map<string, Set<PluginBusHandler>>();
    const pending = new Map<
        string,
        {
            resolve: (v: unknown) => void;
            reject: (e: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    let peersCache: string[] = [];
    let peersAt = 0;
    const peerTtlMs = opts.peerTtlMs ?? 5_000;
    let available = false;

    const refreshPeers = async (): Promise<string[]> => {
        const now = Date.now();
        if (now - peersAt < peerTtlMs && peersCache.length > 0) {
            return peersCache;
        }
        try {
            peersCache = await fetchPeerRoster(opts.main, opts.prefix);
            peersAt = now;
        } catch (err) {
            log.warn('Peer roster fetch failed', err);
        }
        return peersCache;
    };

    const deliverLocal = async (msg: PluginBusMessage): Promise<unknown> => {
        const set = handlers.get(msg.channel);
        if (!set || set.size === 0) {
            if (msg.kind === 'request') {
                throw new Error(`No handler for channel ${msg.channel}`);
            }
            return undefined;
        }
        let last: unknown;
        for (const h of set) {
            last = await h(msg.payload, {
                fromMachineId: msg.fromMachineId,
                channel: msg.channel,
                requestId: msg.requestId,
            });
        }
        return last;
    };

    const publish = async (msg: PluginBusMessage): Promise<void> => {
        await opts.pub.publish(
            channelPluginBus(opts.prefix),
            encodeMessage(msg).toString('base64'),
        );
    };

    const onMessage = (channel: string, payload: string) => {
        if (channel === channelControlShutdown(opts.prefix)) {
            void (async () => {
                try {
                    const raw = decodeMessage(Buffer.from(payload, 'base64'));
                    const parsed = controlShutdownSchema.safeParse(raw);
                    if (!parsed.success) return;
                    const msg = parsed.data;
                    if (msg.scope === 'fleet') {
                        await performLocalShutdown(msg.reason);
                        return;
                    }
                    if (msg.scope === 'machine' && msg.machineId === opts.machineId) {
                        await performLocalShutdown(msg.reason);
                    }
                } catch (err) {
                    log.warn('Shutdown control handling error', err);
                }
            })();
            return;
        }
        if (channel !== channelPluginBus(opts.prefix)) return;
        void (async () => {
            try {
                const raw = decodeMessage(Buffer.from(payload, 'base64'));
                const parsed = pluginBusMessageSchema.safeParse(raw);
                if (!parsed.success) return;
                const msg = parsed.data as PluginBusMessage;

                if (msg.kind === 'response') {
                    if (!msg.requestId) return;
                    const p = pending.get(msg.requestId);
                    if (!p) return;
                    clearTimeout(p.timer);
                    pending.delete(msg.requestId);
                    p.resolve(msg.payload);
                    return;
                }

                const forMe =
                    msg.toMachineId === opts.machineId || msg.toMachineId === '*';
                if (!forMe) return;

                if (msg.kind === 'request') {
                    try {
                        const result = await deliverLocal(msg);
                        await publish({
                            kind: 'response',
                            channel: msg.channel,
                            fromMachineId: opts.machineId,
                            toMachineId: msg.fromMachineId,
                            payload: result,
                            requestId: msg.requestId,
                        });
                    } catch (err) {
                        await publish({
                            kind: 'response',
                            channel: msg.channel,
                            fromMachineId: opts.machineId,
                            toMachineId: msg.fromMachineId,
                            payload: {
                                __error: err instanceof Error ? err.message : String(err),
                            },
                            requestId: msg.requestId,
                        });
                    }
                    return;
                }

                await deliverLocal(msg);
            } catch (err) {
                log.warn('Plugin bus message error', err);
            }
        })();
    };

    await opts.sub.subscribe(
        channelPluginBus(opts.prefix),
        channelControlShutdown(opts.prefix),
    );
    opts.sub.on('message', onMessage);
    await refreshPeers();
    available = true;

    const peerTimer = setInterval(() => {
        void refreshPeers();
    }, peerTtlMs);
    peerTimer.unref();

    const bus: CrossHostBus = {
        isAvailable: () => available,
        machineId: () => opts.machineId,
        peers: () => peersCache,
        async send(target: string, channel: string, payload: unknown): Promise<void> {
            if (!available) throw new Error('Plugin bus not started');
            if (target === opts.machineId) {
                await deliverLocal({
                    kind: 'send',
                    channel,
                    fromMachineId: opts.machineId,
                    toMachineId: target,
                    payload,
                });
                return;
            }
            await publish({
                kind: 'send',
                channel,
                fromMachineId: opts.machineId,
                toMachineId: target,
                payload,
            });
            if (target === '*') {
                await deliverLocal({
                    kind: 'send',
                    channel,
                    fromMachineId: opts.machineId,
                    toMachineId: '*',
                    payload,
                });
            }
        },
        async request(
            target: string,
            channel: string,
            payload: unknown,
            timeoutMs = 10_000,
        ): Promise<unknown> {
            if (!available) throw new Error('Plugin bus not started');
            if (target === '*') {
                throw new Error('request() requires a specific machineId, not "*"');
            }
            if (target === opts.machineId) {
                return deliverLocal({
                    kind: 'request',
                    channel,
                    fromMachineId: opts.machineId,
                    toMachineId: target,
                    payload,
                    requestId: randomBytes(8).toString('hex'),
                });
            }
            const requestId = randomBytes(12).toString('hex');
            const result = await new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(requestId);
                    reject(new Error(`Plugin bus request timeout channel=${channel}`));
                }, timeoutMs);
                timer.unref();
                pending.set(requestId, { resolve, reject, timer });
                void publish({
                    kind: 'request',
                    channel,
                    fromMachineId: opts.machineId,
                    toMachineId: target,
                    payload,
                    requestId,
                }).catch((err) => {
                    clearTimeout(timer);
                    pending.delete(requestId);
                    reject(err instanceof Error ? err : new Error(String(err)));
                });
            });
            if (
                result &&
                typeof result === 'object' &&
                '__error' in (result as Record<string, unknown>)
            ) {
                throw new Error(String((result as { __error: unknown }).__error));
            }
            return result;
        },
        on(channel: string, handler: PluginBusHandler): void {
            let set = handlers.get(channel);
            if (!set) {
                set = new Set();
                handlers.set(channel, set);
            }
            set.add(handler);
        },
        off(channel: string, handler: PluginBusHandler): void {
            handlers.get(channel)?.delete(handler);
        },
        async shutdownWorker(machineId: string, reason?: string): Promise<void> {
            if (!available) throw new Error('Plugin bus not started');
            if (machineId === opts.machineId) {
                await performLocalShutdown(reason);
                return;
            }
            await opts.pub.publish(
                channelControlShutdown(opts.prefix),
                encodeMessage({
                    scope: 'machine',
                    machineId,
                    reason: reason ?? 'worker shutdown',
                    fromMachineId: opts.machineId,
                }).toString('base64'),
            );
        },
    };

    log.info('Plugin bus started', { machineId: opts.machineId });
        void import('#core/manager/event.js')
            .then(({ eventBus }) => eventBus.emitConcurrent('crosshost.plugin_bus.started', { machineId: opts.machineId }))
            .catch(() => undefined);

    return bus;
}

export async function publishControlShutdown(
    pub: Redis,
    prefix: string,
    message: {
        scope: 'fleet' | 'machine' | 'orchestrator';
        machineId?: string;
        reason: string;
        fromMachineId: string;
    },
): Promise<void> {
    await pub.publish(
        channelControlShutdown(prefix),
        encodeMessage(message).toString('base64'),
    );
}
