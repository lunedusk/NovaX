# Zene Cross-Host

Multi-machine Discord shard hosting with a thin orchestrator control plane and stripped workers.

**Status:** Part A implemented (boot branch, auth, membership, dual-orchestrator claim). Later milestones add snapshot distribution, shard map, identify grants, rebalance, rolling updates, and optional index.

## Roles

| Role | `CROSS_HOST_ROLE` | Behaviour |
|------|-------------------|-----------|
| Orchestrator | `orchestrator` | Control plane only. No Discord Client, no plugins, no normal bot API. Owns membership, HMAC challenges, deep compatibility checks, machine tokens, startup claim, and the HTTP register surface. |
| Worker | `worker` | Registers over HTTP, then receives Redis control-plane material. Full Client and plugin load come in later milestones after acceptance. |

Classic standalone and single-host `isSharded` (`ShardingManager`) paths are unchanged when `CROSS_HOST` is false or unset.

## Join flow (Part A)

1. Worker requires `CROSS_HOST_MACHINE_ID`, `CROSS_HOST_ORCHESTRATOR_URL`, and `CROSS_HOST_CLUSTER_SECRET`.
2. **Challenge (step 1):** `GET /cross-host/v1/challenge?machineId=…` → `{ challengeId, nonce, expiresAt }`.
3. Worker computes `manifestHash` over Zene version + sorted `id@version` plugin pairs, then  
   `HMAC-SHA256(clusterSecret, nonce|machineId|manifestHash|zeneVersion|bootGeneration)`.
4. **Register (step 2):** `POST /cross-host/v1/register` with identity, plugin list, challengeId, and HMAC.
5. Orchestrator verifies challenge (single-use, TTL), HMAC, then **deep check**.
6. On success: short-lived machine token, Redis alias + channel prefix, generation, assigned shards (empty until later milestones), snapshot version (0 until M3), desired state, compat mode.
7. On failure: structured reason code; **no** Redis material and **no** gateway eligibility.

## Auth

- **HMAC** challenge-response (above). Failures: `HMAC_INVALID`, `CHALLENGE_MISSING`, `CHALLENGE_EXPIRED`.
- **Machine token:** HMAC-SHA256 signed opaque token `base64url(json claims).base64url(sig)` with `mid`, `iat`, `exp`, `jti`. TTL: `CROSS_HOST_TOKEN_TTL_SEC` (default 3600).
- **Optional mTLS:** `CROSS_HOST_MTLS_ENABLED=true` plus cert/key/CA paths on both sides.

## Compatibility (`CROSS_HOST_COMPAT_MODE`)

| Mode | Rule |
|------|------|
| `strict` (default) | Exact Zene version string and exact set of `(plugin id, version)` pairs (order-independent). |
| `range` | Same plugin **ids** required. Zene and each plugin version must equal desired or satisfy `SemVer.satisfies(version, desired)`. |

Desired state on the orchestrator is the local `package.json` version plus `plugins/*/manifest.json` id/version pairs.

## Dual-orchestrator claim

On orchestrator start a Redis key `zene:crosshost:orchestrator:claim` is acquired with `SET NX` and a short TTL, renewed while the process lives. A second orchestrator against the same Redis receives `CLAIM_CONFLICT` and must exit.

**Disclaimer:** Do not run two orchestrators against the same bot token / cluster secret / Redis instance. The Redis instance used for cross-host control must not be casually shared with unrelated workloads.

## Redis resolution

Prefer `Database.crosshost` when it is a Redis URI (`redis://` / `rediss://` or `engine: "redis"`).  
If absent, fall back to `Database.main` when that entry is Redis.  
If neither is available, Cross-Host **fails boot** with a clear error.

## HTTP surface (orchestrator)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + generation + claim fingerprint prefix |
| GET | `/cross-host/v1/challenge` | Issue one-time nonce for a machineId |
| POST | `/cross-host/v1/register` | HMAC + deep check + token issuance |

Bind: `CROSS_HOST_HTTP_HOST` (default `0.0.0.0`), `CROSS_HOST_HTTP_PORT` (default `8020`).

## Environment

See **ENV Reference.md → Cross-Host / Orchestrator** for the full variable table.

## Reason codes (Part A)

`OK`, `HMAC_INVALID`, `VERSION_MISMATCH_STRICT`, `VERSION_OUT_OF_RANGE`, `PLUGIN_SET_MISMATCH`, `DUPLICATE_MACHINE_ID`, `CLAIM_CONFLICT`, `INVALID_PAYLOAD`, `CHALLENGE_EXPIRED`, `CHALLENGE_MISSING`, `MACHINE_ID_REQUIRED`, `UNAUTHORIZED`, `INTERNAL`.

## Snapshot distribution (Part B)

Orchestrator loads `configManager` / `i18n` / `emojis` with FileWatcher and publishes versioned snapshots.

- Document shape: `{ config, lang, emoji }` from manager `dumpSnapshot()`.
- Diffs: RFC6902 via `fast-json-patch`. Workers apply with `applySnapshot` (no disk).
- Notify channel: `{prefix}:snapshot:notify`. Pull: `GET /cross-host/v1/snapshot` with Bearer machine token.
- Failed diff → full pull fallback.

## Shard map & identify (Part B)

- `totalShards`: `CROSS_HOST_TOTAL_SHARDS` override, else Discord `GET /gateway/bot` `shards`.
- `max_concurrency` from the same endpoint drives identify grant buckets (`shardId % max_concurrency`).
- Assignment updates: `{prefix}:assignment:update` with generation fencing.
- Identify grants: `{prefix}:identify:grant`. Worker must not Identify without a valid grant.
- Empty shard list → no `client.login()` (standby).
- Worker load order: register → Redis → snapshot hydrate (`applySnapshot`) → `pluginManager.preloadAll` → Client (if shards) → grants → login → `bootAll`.

## Load score & rebalance (Part C)

```
loadScore = wG*guilds + wM*members + wE*eventRate + wC*commandRate + wS*shardCount
```

- `memberCount` is included only when the worker Client has Guild Members privileged intent; otherwise it is omitted and `wM` does not apply.
- `eventRate` / `commandRate` are Client-local counts over the stats window (standby → 0).
- Strategies: `least_loaded` (default), `sticky`, `manual` (all-or-nothing overlay validation), `region_aware`.
- Rebalance: cooldown, imbalance threshold, max moves per cycle, min improvement gate, round-robin donors. Workers in an in-flight rolling update are excluded.

## Rolling updates (Part C)

Drain-first: clear shards → `UpdateInstruct` → worker runs existing updater → ack → exit for restart → re-register + deep check before new shards. Concurrency: `CROSS_HOST_MAX_CONCURRENT_UPDATES`.

## Storage gate (Part D)

When `CROSS_HOST=true`, boot **fails** if any `Database` alias uses sqlite / native-sqlite / better-sqlite3 or a file-path URI that looks like a local SQLite file. Per-worker `native-novadb` (or other non-sqlite engines) may still hold local audit/error bodies. Multi-host **fetch** of those bodies is via the query RPC layer, not a shared sqlite file.

## Audit / error query (Part D)

Cross-worker access uses Redis RPC (`{prefix}:query:request` / `{prefix}:query:response`).

| Mode | Behaviour |
|------|-----------|
| Single-shard | Caller supplies `shardId` → owner from shard map → one RPC |
| Index-first | When optional index is enabled: list metadata → fetch full bodies from owning workers |
| Scatter-gather | Index off or miss: fan-out to all live workers with `CROSS_HOST_QUERY_CONCURRENCY` and `CROSS_HOST_QUERY_TIMEOUT_MS`; `partial: true` if any fail |

Public helper (orchestrator process): `getCrossHostQuery()` → `{ audit: { list, get }, errors: { list, get } }`.

Workers handle `audit.list` / `audit.get` / `error.list` / `error.get` by calling existing local store APIs.

Native post-write: after successful audit/error record on a **Cross-Host worker**, best-effort index metadata publish (never fails the primary write). Standalone / classic bots never enter this path.

## Optional secondary index (Part D)

| Variable | Default | Notes |
|----------|---------|-------|
| `CROSS_HOST_INDEX_ENABLED` | `false` | Optional module; cluster works without it |
| `CROSS_HOST_INDEX_BACKEND` | `redis` | `redis` \| `postgres` |
| `CROSS_HOST_INDEX_RETENTION_DAYS` | `14` | Trim / TTL |

- **Redis backend:** uses the Cross-Host Redis alias (sorted sets + hashes for metadata only).
- **Postgres backend:** prefer `Database.crosshost_index`, else postgres `Database.main`. If neither exists → **warn and disable index** for this process (soft-disable; do not fail boot).
- Index stores metadata only; full bodies always from owning workers.

## Query env

| Variable | Default |
|----------|---------|
| `CROSS_HOST_QUERY_TIMEOUT_MS` | `5000` |
| `CROSS_HOST_QUERY_CONCURRENCY` | `16` |

## Reason codes (extended)

Part A codes plus operational: `QUERY_TIMEOUT`, `QUERY_PUBLISH_FAILED`, `QUERY_PARTIAL` (result flag), `INDEX_UNAVAILABLE` (soft-disable reason logged).

## Dual-orchestrator disclaimer

Only one orchestrator should hold the Redis claim. A second process that fails the claim must exit. Workers keep gateway sessions if the orchestrator dies; joins/rebalances pause until a new orchestrator claims and rebuilds view from Redis + heartbeats.

## Failure behaviour (summary)

| Event | Behaviour |
|-------|-----------|
| Worker dead | Shards cleared after suspect + grace; rebalance fills |
| Orchestrator die | Workers keep shards; control plane pauses until claim |
| Snapshot diff fail | Worker full-pulls envelope |
| Index postgres missing | Index disabled; scatter-gather continues |
| Sqlite in Database | Boot fails (storage gate) |


## Plugin bus & process control

- Workers expose `this.heart.crossHost` (send / request / on / peers / shutdownWorker) after the control plane starts.
- Peer machine ids are published by the orchestrator to Redis (`{prefix}:peers`) and TTL-cached on workers.
- `this.heart.control.shutdown()` exits the local process in any mode.
- `shutdownFleet` publishes `{prefix}:control:shutdown` with `scope: fleet` then exits; workers and orchestrator exit on receipt.
- `shutdownMachine` / `crossHost.shutdownWorker` target a single worker id.


## Public API gateway (single URL)

When `CROSS_HOST_API_GATEWAY_ENABLED=true` (default), the **orchestrator HTTP server** reverse-proxies non-control routes to workers.

| Path | Handler |
|------|---------|
| `/cross-host/*`, `/health` | Orchestrator control plane |
| Everything else | Proxy to a worker |

**Affinity**

- If `guildId` / `guild_id` is present (query, JSON body, or `X-Zene-Guild-Id`):  
  `shardId = (guildId >> 22) % totalShards` → worker that owns that shard.
- Otherwise: any worker that has advertised `apiBaseUrl` (round-robin by time).

**Workers** must set `CROSS_HOST_WORKER_API_ADVERTISE_HOST` to a host/IP reachable from the orchestrator. They bind `CROSS_HOST_WORKER_API_HOST`:`CROSS_HOST_WORKER_API_PORT` (default `APIPort`).

Discord gateway events (slash ban, etc.) are **already** shard-correct and do not use this proxy. HTTP plugin routes that need guild-local state must include `guildId`.

Token and other global routes use **any** worker (plugins run on workers only; orchestrator does not load plugins).

## EventBus (Cross-Host)

Workers and the orchestrator emit typed events on the shared `eventBus`. Full catalog: [EVENTS.md](EVENTS.md).

Notable Cross-Host events:

| Event | Role |
|-------|------|
| `crosshost.storage.gate.passed` | Both |
| `crosshost.claim.acquired` | Orchestrator |
| `crosshost.orchestrator.ready` | Orchestrator |
| `crosshost.worker.registered` | Worker |
| `crosshost.heartbeat.started` | Worker |
| `crosshost.snapshot.applied` | Worker |
| `crosshost.assignment.applied` | Worker |
| `crosshost.identify.granted` | Orchestrator |
| `crosshost.rebalance` | Orchestrator |
| `crosshost.worker.dead` | Orchestrator |
| `crosshost.plugin_bus.started` | Worker |

Also: `shard.ready` / `shard.disconnect` / `shard.set.changed` on workers that own Discord shard Clients; `system.shutdown.*` on both roles during graceful teardown.

Plugins on workers may subscribe in `onEnable`:

```ts
this.heart.system.eventBus.on('crosshost.assignment.applied', (p) => { /* ... */ });
```

(Access path may be `eventBus` import from `#core/manager/event.js` when not exposed on heart — prefer the public EventBus import.)
