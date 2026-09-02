import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import type {
    DesiredState,
    PluginIdVersion,
    RegisterReasonCode,
    WorkerView,
} from '../types.js';
import {
    buildManifestHash,
    computeRegisterHmac,
    createChallenge,
    verifyHmacEqual,
    type ChallengeRecord,
} from '../auth/hmac.js';
import { issueMachineToken } from '../auth/tokens.js';
import { runDeepCheck } from './deepCheck.js';
import type { CompatMode } from '../types.js';
import type { RegisterRequestParsed } from '../protocol/messages.js';

const log = getLogger('CrossHost:Membership');

export interface MembershipConfig {
    readonly clusterSecret: string;
    readonly compatMode: CompatMode;
    readonly tokenTtlSec: number;
    readonly redisAlias: string;
    readonly channelPrefix: string;
}

export interface AcceptResult {
    readonly ok: true;
    readonly generation: number;
    readonly assignedShards: readonly number[];
    readonly totalShards: number;
    readonly machineToken: string;
    readonly machineTokenExpiresAt: number;
    readonly snapshotVersion: number;
    readonly desiredState: DesiredState;
    readonly compatMode: CompatMode;
    readonly redisAlias: string;
    readonly channelPrefix: string;
}

export interface RejectResult {
    readonly ok: false;
    readonly reason: RegisterReasonCode;
    readonly message: string;
}

export type RegisterResult = AcceptResult | RejectResult;

export class MembershipRegistry {
    private readonly workers = new Map<string, WorkerView>();
    private readonly challenges = new Map<string, ChallengeRecord>();
    private generation = 1;
    private snapshotVersion = 0;
    private totalShards = 1;
    private desiredState: DesiredState;
    private readonly config: MembershipConfig;
    private shardLookup: ((machineId: string) => number[]) | null = null;

    constructor(config: MembershipConfig, desiredState: DesiredState) {
        this.config = config;
        this.desiredState = desiredState;
    }

    public setTotalShards(n: number): void {
        this.totalShards = n;
    }

    public getTotalShards(): number {
        return this.totalShards;
    }

    public setSnapshotVersion(v: number): void {
        this.snapshotVersion = v;
    }

    public setShardLookup(fn: (machineId: string) => number[]): void {
        this.shardLookup = fn;
    }

    public setWorkerShards(machineId: string, shards: readonly number[]): void {
        const w = this.workers.get(machineId);
        if (!w) return;
        this.workers.set(machineId, { ...w, shards: [...shards] });
    }

    public removeWorker(machineId: string): boolean {
        const had = this.workers.delete(machineId);
        if (had) {
            log.info('Worker removed from membership', { machineId });
        }
        return had;
    }

    public isLive(machineId: string, maxAgeMs: number): boolean {
        const w = this.workers.get(machineId);
        if (!w) return false;
        return Date.now() - w.lastSeenAt <= maxAgeMs;
    }

    public setWorkerSnapshotAck(machineId: string, version: number): void {
        const w = this.workers.get(machineId);
        if (!w) return;
        this.workers.set(machineId, { ...w, snapshotVersionAck: version, lastSeenAt: Date.now() });
    }

    public bumpGeneration(n?: number): number {
        if (typeof n === 'number' && n > this.generation) {
            this.generation = n;
        } else {
            this.generation += 1;
        }
        return this.generation;
    }

    public getGeneration(): number {
        return this.generation;
    }

    public getSnapshotVersion(): number {
        return this.snapshotVersion;
    }

    public getDesiredState(): DesiredState {
        return this.desiredState;
    }

    public setDesiredState(state: DesiredState): void {
        this.desiredState = state;
    }

    public getWorker(machineId: string): WorkerView | undefined {
        return this.workers.get(machineId);
    }

    public setApiBaseUrl(machineId: string, apiBaseUrl: string | null): void {
        const w = this.workers.get(machineId);
        if (!w) return;
        this.workers.set(machineId, { ...w, apiBaseUrl, lastSeenAt: Date.now() });
    }

    public listWorkers(): readonly WorkerView[] {
        return [...this.workers.values()];
    }

    public issueChallenge(machineId: string): ChallengeRecord {
        const existing = [...this.challenges.values()].filter((c) => c.machineId === machineId);
        for (const c of existing) {
            this.challenges.delete(c.challengeId);
        }
        const record = createChallenge(machineId);
        this.challenges.set(record.challengeId, record);
        log.info('Challenge issued', {
            machineId,
            challengeId: record.challengeId,
            expiresAt: record.expiresAt,
        });
        return record;
    }

    public register(body: RegisterRequestParsed): RegisterResult {
        const now = Date.now();
        const challenge = this.challenges.get(body.challengeId);
        if (!challenge) {
            log.warn('Register rejected: challenge missing', { machineId: body.machineId });
            return {
                ok: false,
                reason: 'CHALLENGE_MISSING',
                message: 'Unknown or already consumed challengeId',
            };
        }
        this.challenges.delete(body.challengeId);

        if (challenge.expiresAt < now) {
            log.warn('Register rejected: challenge expired', { machineId: body.machineId });
            return {
                ok: false,
                reason: 'CHALLENGE_EXPIRED',
                message: 'Challenge expired; request a new one',
            };
        }
        if (challenge.machineId !== body.machineId) {
            log.warn('Register rejected: challenge machineId mismatch', {
                machineId: body.machineId,
                challengeMachineId: challenge.machineId,
            });
            return {
                ok: false,
                reason: 'HMAC_INVALID',
                message: 'Challenge was issued for a different machineId',
            };
        }

        const manifestHash = buildManifestHash(body.novaxVersion, body.plugins);
        const expectedHmac = computeRegisterHmac(this.config.clusterSecret, {
            nonce: challenge.nonce,
            machineId: body.machineId,
            manifestHash,
            novaxVersion: body.novaxVersion,
            bootGeneration: body.bootGeneration,
        });
        if (!verifyHmacEqual(expectedHmac, body.hmac)) {
            log.warn('Register rejected: HMAC invalid', { machineId: body.machineId });
            return {
                ok: false,
                reason: 'HMAC_INVALID',
                message: 'HMAC proof failed',
            };
        }

        const check = runDeepCheck(this.config.compatMode, this.desiredState, {
            novaxVersion: body.novaxVersion,
            plugins: body.plugins,
        });
        if (!check.ok) {
            log.warn('Register rejected: deep check failed', {
                machineId: body.machineId,
                reason: check.reason,
                message: check.message,
            });
            return {
                ok: false,
                reason: check.reason,
                message: check.message,
            };
        }

        const existing = this.workers.get(body.machineId);
        if (existing && existing.bootGeneration !== body.bootGeneration) {
            log.info('Replacing prior registration for machine with new bootGeneration', {
                machineId: body.machineId,
                previousBoot: existing.bootGeneration,
                nextBoot: body.bootGeneration,
            });
        }

        const view: WorkerView = {
            machineId: body.machineId,
            novaxVersion: body.novaxVersion,
            plugins: body.plugins.map((p) => ({ id: p.id, version: p.version })),
            nodeVersion: body.nodeVersion,
            platform: body.platform,
            arch: body.arch,
            bootGeneration: body.bootGeneration,
            labels: body.labels ?? {},
            registeredAt: now,
            lastSeenAt: now,
            shards: this.shardLookup ? this.shardLookup(body.machineId) : (existing?.shards ?? []),
            snapshotVersionAck: 0,
            apiBaseUrl:
                typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.length > 0
                    ? body.apiBaseUrl
                    : (existing?.apiBaseUrl ?? null),
        };
        this.workers.set(body.machineId, view);

        const issued = issueMachineToken(
            this.config.clusterSecret,
            body.machineId,
            this.config.tokenTtlSec,
        );

        log.info('Register accepted', {
            machineId: body.machineId,
            generation: this.generation,
            shards: view.shards,
            totalShards: this.totalShards,
            compatMode: this.config.compatMode,
            tokenExpiresAt: issued.expiresAt,
        });

        return {
            ok: true,
            generation: this.generation,
            assignedShards: view.shards,
            totalShards: this.totalShards,
            machineToken: issued.token,
            machineTokenExpiresAt: issued.expiresAt,
            snapshotVersion: this.snapshotVersion,
            desiredState: this.desiredState,
            compatMode: this.config.compatMode,
            redisAlias: this.config.redisAlias,
            channelPrefix: this.config.channelPrefix,
        };
    }

    public touch(machineId: string): void {
        const w = this.workers.get(machineId);
        if (!w) return;
        this.workers.set(machineId, { ...w, lastSeenAt: Date.now() });
    }
}

export async function discoverLocalDesiredState(coreVersion: string): Promise<DesiredState> {
    const pluginsDir = path.join(process.cwd(), 'plugins');
    const plugins: PluginIdVersion[] = [];
    try {
        const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const jsonPath = path.join(pluginsDir, entry.name, 'manifest.json');
            try {
                const raw = await fs.readFile(jsonPath, 'utf8');
                const data = JSON.parse(raw) as unknown;
                if (
                    typeof data === 'object' &&
                    data !== null &&
                    typeof (data as { id?: unknown }).id === 'string' &&
                    typeof (data as { version?: unknown }).version === 'string'
                ) {
                    plugins.push({
                        id: (data as { id: string }).id,
                        version: (data as { version: string }).version,
                    });
                }
            } catch {
                continue;
            }
        }
    } catch {
        log.warn('Could not read plugins directory for desired state; using empty plugin set');
    }

    plugins.sort((a, b) => a.id.localeCompare(b.id));
    return { novaxVersion: coreVersion, plugins };
}

export async function resolveCoreVersion(): Promise<string> {
    try {
        const raw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
        const pkg = JSON.parse(raw) as { version?: string };
        return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
    } catch {
        return '0.0.0';
    }
}
