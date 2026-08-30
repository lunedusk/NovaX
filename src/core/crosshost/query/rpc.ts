import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import type { QueryOp, QueryRequestMessage, QueryResponseMessage } from '../types.js';
import { channelQueryRequest, channelQueryResponse } from '../protocol/channels.js';
import { encodeMessage, decodeMessage } from '../protocol/codec.js';
import { queryRequestSchema, queryResponseSchema } from '../protocol/messages.js';

const log = getLogger('CrossHost:QueryRpc');

export class QueryRpcClient {
    private readonly pub: Redis;
    private readonly sub: Redis;
    private readonly prefix: string;
    private readonly pending = new Map<
        string,
        {
            resolve: (msg: QueryResponseMessage) => void;
            timer: NodeJS.Timeout;
        }
    >();

    constructor(pub: Redis, sub: Redis, prefix: string) {
        this.pub = pub;
        this.sub = sub;
        this.prefix = prefix;
    }

    public async start(): Promise<void> {
        await this.sub.subscribe(channelQueryResponse(this.prefix));
        this.sub.on('message', (channel, payload) => {
            if (channel !== channelQueryResponse(this.prefix)) return;
            try {
                const raw = decodeMessage(Buffer.from(payload, 'base64'));
                const parsed = queryResponseSchema.safeParse(raw);
                if (!parsed.success) return;
                const msg = parsed.data as QueryResponseMessage;
                const pending = this.pending.get(msg.requestId);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pending.delete(msg.requestId);
                pending.resolve(msg);
            } catch (err) {
                log.warn('Query response handling error', err);
            }
        });
    }

    public request(
        targetMachineId: string,
        op: QueryOp,
        payload: unknown,
        timeoutMs: number,
    ): Promise<QueryResponseMessage> {
        const requestId = randomBytes(12).toString('hex');
        const msg: QueryRequestMessage = {
            requestId,
            targetMachineId,
            op,
            payload,
        };
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                resolve({
                    requestId,
                    machineId: targetMachineId,
                    ok: false,
                    error: 'QUERY_TIMEOUT',
                });
            }, timeoutMs);
            timer.unref();
            this.pending.set(requestId, { resolve, timer });
            void this.pub
                .publish(channelQueryRequest(this.prefix), encodeMessage(msg).toString('base64'))
                .catch((err) => {
                    clearTimeout(timer);
                    this.pending.delete(requestId);
                    log.warn('Query publish failed', err);
                    resolve({
                        requestId,
                        machineId: targetMachineId,
                        ok: false,
                        error: 'QUERY_PUBLISH_FAILED',
                    });
                });
        });
    }
}

export type QueryHandler = (op: QueryOp, payload: unknown) => Promise<unknown>;

export async function startQueryRpcServer(
    sub: Redis,
    pub: Redis,
    prefix: string,
    machineId: string,
    handler: QueryHandler,
): Promise<void> {
    await sub.subscribe(channelQueryRequest(prefix));
    sub.on('message', (channel, payload) => {
        if (channel !== channelQueryRequest(prefix)) return;
        void (async () => {
            try {
                const raw = decodeMessage(Buffer.from(payload, 'base64'));
                const parsed = queryRequestSchema.safeParse(raw);
                if (!parsed.success) return;
                const req = parsed.data as QueryRequestMessage;
                if (req.targetMachineId !== machineId) return;
                try {
                    const data = await handler(req.op, req.payload);
                    const res: QueryResponseMessage = {
                        requestId: req.requestId,
                        machineId,
                        ok: true,
                        data,
                    };
                    await pub.publish(
                        channelQueryResponse(prefix),
                        encodeMessage(res).toString('base64'),
                    );
                } catch (err) {
                    const res: QueryResponseMessage = {
                        requestId: req.requestId,
                        machineId,
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    };
                    await pub.publish(
                        channelQueryResponse(prefix),
                        encodeMessage(res).toString('base64'),
                    );
                }
            } catch (err) {
                log.warn('Query request handling error', err);
            }
        })();
    });
}
