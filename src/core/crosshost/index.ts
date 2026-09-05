export type {
    CrossHostRole,
    CompatMode,
    RegisterReasonCode,
    AssignmentReason,
    PluginIdVersion,
    DesiredState,
    RegisterRequestBody,
    RegisterSuccessBody,
    RegisterFailureBody,
    RegisterResponseBody,
    ChallengeResponseBody,
    WorkerView,
    CrossHostEnv,
    ResolvedRedis,
    RedisMaterial,
    SnapshotDocument,
    SnapshotEnvelope,
    SnapshotNotifyMessage,
    AssignmentUpdateMessage,
    IdentifyGrantMessage,
    HeartbeatMessage,
    GatewayBotInfo,
    IndexRecordMeta,
    IndexKind,
    QueryOp,
    QueryRequestMessage,
    QueryResponseMessage,
} from './types.js';

export { runCrossHost } from './bootstrap.js';
export { loadCrossHostEnv, resolveCrossHostRedis } from './env.js';
export {
    buildManifestHash,
    computeRegisterHmac,
    createChallenge,
    verifyHmacEqual,
} from './auth/hmac.js';
export { issueMachineToken, verifyMachineToken } from './auth/tokens.js';
export { acquireOrchestratorClaim } from './auth/claim.js';
export { runDeepCheck } from './orchestrator/deepCheck.js';
export { MembershipRegistry } from './orchestrator/membership.js';
export { SnapshotService, buildSnapshotDocument } from './orchestrator/snapshot.js';
export { ShardMap } from './orchestrator/shardMap.js';
export { IdentifyQueue } from './orchestrator/identifyQueue.js';
export { fetchGatewayBot } from './orchestrator/gatewayInfo.js';
export { registerWithOrchestrator, runWorkerControlPlane } from './worker/adapter.js';
export { SnapshotCache } from './worker/snapshotCache.js';
export { workerHooks } from './worker/hooks.js';
export { IdentifyGrantWaiter } from './worker/identifyClient.js';

export { RebalanceEngine } from './orchestrator/rebalance.js';
export { UpdateController } from './orchestrator/updateController.js';
export { getStrategy } from './orchestrator/strategies/index.js';
export { computeLoadScore, computeImbalance } from './orchestrator/metrics.js';
export { StatsCollector } from './worker/statsCollector.js';

export { getCrossHostQuery, setCrossHostQueryFacade, buildQueryFacade } from './query/facade.js';
export type { CrossHostQueryFacade } from './query/facade.js';
export { assertCrossHostStorageAllowed } from './storageGate.js';
export {
    isCrossHostWorker,
    markCrossHostWorkerActive,
    setCrossHostWorkerShards,
    getCrossHostWorkerMachineId,
    getCrossHostWorkerShards,
} from './runtimeFlag.js';
export { resolveIndexBackend } from './indexStore/resolve.js';
export type { IndexBackend, IndexResolveResult } from './indexStore/types.js';

export { shardIdForGuild, extractGuildId, classifyAffinity } from './gateway/affinity.js';
export type { AffinityClass } from './gateway/affinity.js';
