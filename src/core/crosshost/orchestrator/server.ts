import http from 'node:http';
import https from 'node:https';
import express, { type Request, type Response, type NextFunction } from 'express';
import { getLogger } from '#core/utils/logger.js';
import type { CrossHostEnv } from '../types.js';
import { loadMtlsMaterial } from '../auth/mtls.js';
import { verifyMachineToken } from '../auth/tokens.js';
import {
    challengeQuerySchema,
    registerRequestSchema,
} from '../protocol/messages.js';
import type { MembershipRegistry } from './membership.js';
import type { ClaimHandle } from '../auth/claim.js';
import type { SnapshotService } from './snapshot.js';
import type { IdentifyQueue } from './identifyQueue.js';
import type { ShardMap } from './shardMap.js';
import { mountApiGateway } from '../gateway/apiGateway.js';

const log = getLogger('CrossHost:Orchestrator');

export interface OrchestratorServerHandle {
    readonly port: number;
    stop(): Promise<void>;
}

export async function startOrchestratorServer(
    env: CrossHostEnv,
    membership: MembershipRegistry,
    claim: ClaimHandle,
    snapshot: SnapshotService | null = null,
    identifyQueue: IdentifyQueue | null = null,
    shardMap: ShardMap | null = null,
    onWorkerJoined: ((machineId: string) => void | Promise<void>) | null = null,
): Promise<OrchestratorServerHandle> {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    app.use((req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();
        res.on('finish', () => {
            const ms = Date.now() - start;
            const line = `[${req.method}] ${req.path} ${res.statusCode} ${ms}ms`;
            if (res.statusCode >= 500) log.error(line);
            else if (res.statusCode >= 400) log.warn(line);
            else log.debug(line);
        });
        next();
    });

    app.get('/health', (_req: Request, res: Response) => {
        res.status(200).json({
            ok: true,
            role: 'orchestrator',
            generation: membership.getGeneration(),
            snapshotVersion: membership.getSnapshotVersion(),
            claimFingerprint: claim.fingerprint.slice(0, 12),
        });
    });

    app.get('/cross-host/v1/challenge', (req: Request, res: Response) => {
        const machineIdRaw = req.query.machineId;
        const machineId =
            typeof machineIdRaw === 'string'
                ? machineIdRaw
                : Array.isArray(machineIdRaw)
                  ? machineIdRaw[0]
                  : undefined;
        const parsed = challengeQuerySchema.safeParse({ machineId });
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                reason: 'INVALID_PAYLOAD',
                message: parsed.error.issues.map((i) => i.message).join('; '),
            });
            return;
        }
        const challenge = membership.issueChallenge(parsed.data.machineId);
        res.status(200).json({
            challengeId: challenge.challengeId,
            nonce: challenge.nonce,
            expiresAt: challenge.expiresAt,
        });
    });

    app.post('/cross-host/v1/register', async (req: Request, res: Response) => {
        const parsed = registerRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            log.warn('Register rejected: invalid payload', {
                issues: parsed.error.issues.map((i) => i.message),
            });
            res.status(400).json({
                ok: false,
                reason: 'INVALID_PAYLOAD',
                message: parsed.error.issues.map((i) => i.message).join('; '),
            });
            return;
        }

        const result = membership.register(parsed.data);
        if (!result.ok) {
            const status =
                result.reason === 'HMAC_INVALID' ||
                result.reason === 'CHALLENGE_MISSING' ||
                result.reason === 'CHALLENGE_EXPIRED'
                    ? 401
                    : result.reason === 'DUPLICATE_MACHINE_ID'
                      ? 409
                      : 403;
            res.status(status).json({
                ok: false,
                reason: result.reason,
                message: result.message,
            });
            return;
        }

        if (onWorkerJoined) {
            try {
                await onWorkerJoined(parsed.data.machineId);
            } catch (err: unknown) {
                log.warn('onWorkerJoined hook failed', err);
            }
        }

        const assignedShards = shardMap
            ? shardMap.shardsFor(parsed.data.machineId)
            : result.assignedShards;
        const generation = shardMap ? shardMap.getGeneration() : result.generation;

        res.status(200).json({
            ok: true,
            generation,
            assignedShards,
            totalShards: result.totalShards,
            redis: {
                alias: result.redisAlias,
                channelPrefix: result.channelPrefix,
            },
            machineToken: result.machineToken,
            machineTokenExpiresAt: result.machineTokenExpiresAt,
            snapshotVersion: result.snapshotVersion,
            desiredState: result.desiredState,
            compatMode: result.compatMode,
        });

    });

    app.get('/cross-host/v1/snapshot', (req: Request, res: Response) => {
        if (!snapshot) {
            res.status(503).json({
                ok: false,
                reason: 'INTERNAL',
                message: 'Snapshot service not ready',
            });
            return;
        }
        const auth = req.headers.authorization;
        if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
            res.status(401).json({
                ok: false,
                reason: 'UNAUTHORIZED',
                message: 'Bearer machine token required',
            });
            return;
        }
        const token = auth.slice('Bearer '.length).trim();
        const claims = verifyMachineToken(env.clusterSecret, token);
        if (!claims) {
            res.status(401).json({
                ok: false,
                reason: 'UNAUTHORIZED',
                message: 'Invalid or expired machine token',
            });
            return;
        }
        const versionRaw = req.query.version;
        const versionStr =
            typeof versionRaw === 'string'
                ? versionRaw
                : Array.isArray(versionRaw)
                  ? versionRaw[0]
                  : undefined;
        const envelope =
            versionStr !== undefined
                ? snapshot.getEnvelope(Number(versionStr))
                : snapshot.getLatest();
        if (!envelope) {
            res.status(404).json({
                ok: false,
                reason: 'INTERNAL',
                message: 'Snapshot version not found',
            });
            return;
        }
        log.info('Snapshot pulled', {
            machineId: claims.mid,
            version: envelope.version,
        });
        res.status(200).json({ ok: true, envelope });
    });

    if (env.apiGatewayEnabled && shardMap) {
        mountApiGateway(app, {
            membership,
            shardMap,
            totalShards: () => membership.getTotalShards(),
            proxyTimeoutMs: env.apiProxyTimeoutMs,
        });
        log.info('API gateway proxy mounted on orchestrator HTTP');
    }

    const mtls = loadMtlsMaterial(env);
    const server: http.Server = mtls
        ? https.createServer(mtls.serverOptions, app)
        : http.createServer(app);

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(env.httpPort, env.httpHost, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const addr = server.address();
    const port =
        typeof addr === 'object' && addr !== null ? addr.port : env.httpPort;

    log.info('Orchestrator HTTP control plane listening', {
        host: env.httpHost,
        port,
        mtls: mtls !== null,
        claimFingerprint: claim.fingerprint.slice(0, 12),
    });

    return {
        port,
        async stop() {
            await new Promise<void>((resolve, reject) => {
                if (!server.listening) {
                    resolve();
                    return;
                }
                server.close((err) => {
                    if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
            await claim.stop();
            log.info('Orchestrator HTTP control plane stopped');
        },
    };
}
