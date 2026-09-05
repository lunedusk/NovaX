# Zene EventBus Reference

Authoritative catalog of EventBus events (`eventBus`). Framework lifecycle + Cross-Host are listed below; **Discord bridges add every `Events` enum value** (~89 on discord.js v14) as `discord.<name>`, all typed on `EventArgsMap` (`#core/manager/event.js` → `events/EventBus.ts`).

Typed payload shapes live in `EventArgsMap`. Prefer `eventBus.on` / `once` / `emit` / `emitConcurrent`. Wildcard patterns (e.g. `system.*`) are supported for listeners.

**Mode key**

| Mode | When |
|------|------|
| **all** | Standalone, classic sharded, Cross-Host worker/orchestrator (if the subsystem runs) |
| **client** | Process owns a Discord gateway Client |
| **sharded** | Classic `isSharded` or Cross-Host worker with shard Clients |
| **crosshost-worker** | `CROSS_HOST` + role `worker` |
| **crosshost-orch** | `CROSS_HOST` + role `orchestrator` |
| **crosshost** | Either Cross-Host role |

---

## Counts (approximate)

| Category | Count | Source |
|----------|------:|--------|
| Framework + Cross-Host + audit/error (typed keys) | ~50 | `FrameworkEventArgsMap` |
| Discord dynamic bridges | ~89 | `Object.values(Events)` → `discord.*` |
| **Total typed surface** | **~140** | `EventArgsMap` = framework ∩ Discord bridges |

The log line `Bridged 89 dynamic Discord events` is the Discord slice only — not the whole bus.

---

## Subscribe example

```ts
import { eventBus } from '#core/manager/event.js';

eventBus.on('system.ready', (client) => {
  // client is Client<true>
});

eventBus.on('crosshost.assignment.applied', (payload) => {
  // payload.machineId, previous, next, reason, generation
});

eventBus.on('system.*', (...args) => {
  // wildcard
});
```

Plugins should subscribe in `onEnable` (or after handlers load) and unregister on disable via owner-scoped APIs when available.

---

## Discord bridge events (~89)

`EventManager.bindNativeEvents` loops **`Object.values(Events)`** from discord.js and emits:

```text
discord.${eventName}   // e.g. discord.clientReady, discord.messageCreate, discord.guildMemberAdd, …
```

Payloads are **exactly** the discord.js `ClientEvents[eventName]` argument tuple (typed via `DiscordBridgedEvents` ∩ `EventArgsMap`). Count tracks the installed discord.js version’s `Events` enum (typically ~80–90 entries on v14).

| Common event | Typical payload (see discord.js ClientEvents) | Notes |
|--------------|-----------------------------------------------|-------|
| `discord.clientReady` | `[client: Client<true>]` | Also triggers `system.ready` once |
| `discord.interactionCreate` | `[interaction: Interaction]` | Primary interaction path |
| `discord.error` | `[error: Error]` | Gateway/client errors |
| `discord.guildCreate` / `discord.guildDelete` | guild (+ …) | Guild metrics hooks |
| `discord.messageCreate` | `[message: Message]` | Messages |
| `discord.guildMemberAdd` / `Remove` / `Update` | member tuples | Members |
| `discord.*` (remainder) | `ClientEvents[…]` | Full enum — use `DISCORD_BRIDGED_EVENT_NAMES` or discord.js docs |

**Modes:** any process that binds a Discord Client (standalone, classic shard worker, Cross-Host worker). Orchestrator does **not** bind Clients → no `discord.*` there.

To list names at runtime:

```ts
import { DISCORD_BRIDGED_EVENT_NAMES } from '#core/manager/events/EventBus.js';
// or Object.values(Events) from 'discord.js'
```

---

## System lifecycle

| Event | Payload shape | When | Modes |
|-------|---------------|------|-------|
| `system.boot.start` | `{ mode: string; at: number }` | Boot path entered (`standalone` / `sharded-worker` / `crosshost:orchestrator` / `crosshost:worker`) | all |
| `system.ready` | `Client<true>` | Primary client ready hooks | client |
| `system.shutdown.start` | `{ signal: string; role: string; at: number }` | Graceful shutdown begins | all |
| `system.shutdown.complete` | `{ signal: string; role: string; at: number }` | Shutdown steps finished (before exit) | crosshost (worker/orch) |
| `system.http.ready` | `{ host: string; port: number }` | REST API listening | all with HTTP |
| `system.http.stopped` | `{ at: number }` | REST API stopped | all with HTTP |
| `system.plugins.booted` | `{ count: number; durationMs: number }` | Plugin ecosystem boot complete | client / worker |
| `system.plugins.shutdown` | `{ at: number }` | All plugins shut down | all with plugins |
| `system.log.error` | `{ level?; message; name?; stack?; meta?; at? }` | Logger error-level intercept | all |
| `system.error.unhandled` | `{ message; stack?; origin?; at? }` | Unhandled rejection / exception bridge | all |
| `system.migration.complete` | `{ scope; applied; failed; failedPlugins }` | Migration run finished | all that migrate |
| `system.migration.plugin_failed` | `{ pluginId; error }` | Soft-failed plugin migration | all that migrate |
| `system.secrets.locked` | `{ keyCount: number }` | Secret vault sealed append-only | all |
| `system.database.ready` | `{ alias; engine? }` | Named DB alias connected | all |
| `system.database.closed` | `{ at: number }` | Global DB close complete | all |

---

## Config / lang / emoji

| Event | Payload | When | Modes |
|-------|---------|------|-------|
| `config.loaded` | `{ count }` | ConfigManager disk load | orchestrator / classic (disk) |
| `config.reloaded` | `{ name?; count? }` | Hot reload (when emitted) | disk modes |
| `config.snapshot.applied` | `{ entries }` | Snapshot apply (no disk) | crosshost-worker |
| `lang.loaded` | `{ namespaces }` | LanguageManager init | disk modes |
| `lang.reloaded` | `{ namespaces? }` | Hot reload (when emitted) | disk modes |
| `lang.snapshot.applied` | `{ entries }` | Snapshot apply | crosshost-worker |
| `emoji.loaded` | `{ count }` | Emoji load (when emitted) | disk modes |
| `emoji.synced` | `{ count? }` | Emoji sync complete (when emitted) | client |
| `emoji.snapshot.applied` | `{ entries }` | Snapshot apply | crosshost-worker |

---

## Permissions / guild gate / guild access / plugins / interactions

| Event | Payload | When | Modes |
|-------|---------|------|-------|
| `permissions.ready` | `{ engine; alias }` | PermissionsManager init | client / worker |
| `guildgate.ready` | `{ engine; alias }` | GuildGate ready | client / worker |
| `guildaccess.ready` | `{ engine; alias }` | GuildAccess (leave lists) ready | client / worker |
| `guildaccess.changed` | `{ kind; guildId; action }` | Blacklist / whitelist / owner-authorize mutation | client / worker |
| `plugin.enabled` | `{ pluginId; version?; durationMs? }` | Single plugin enabled | client / worker |
| `plugin.disabled` | `{ pluginId }` | Plugin disabled (when emitted) | all |
| `plugin.preload.complete` | `{ count }` | Preload finished (when emitted) | crosshost-worker |
| `interaction.commands.synced` | `{ count; guildId?; global }` | Slash/context commands deployed | client / worker |
| `interaction.handled` | `{ category; commandName?; pluginId?; guildId?; success; durationMs? }` | Reserved for pipeline telemetry (emit when wired) | client |
| `command:executed` | `{ pluginId; commandName }` | Command path executed (legacy name) | client |

**Guild gate** = soft block (bot stays). **Guild access** = leave policy (blacklist / whitelist / owner-authorized). Neither replaces Discord permissions.

**Feature requirements** (`#core/manager/featureRequirements.js`): not event-bus messages. On client ready, missing **intents** are logged as console soft-warns. On `GuildCreate`, missing **permissions** may DM the Discord server owner or post in a staff/sendable channel (see README / System Prompt).

---

## Shard adapter

| Event | Payload | When | Modes |
|-------|---------|------|-------|
| `shard.ready` | `{ shardId; totalShards; userTag }` | Per-shard Client ready | sharded / crosshost-worker |
| `shard.disconnect` | `{ shardId; reason? }` | Shard Client destroyed | sharded / crosshost-worker |
| `shard.set.changed` | `{ previous; next; totalShards; reason? }` | Diff apply of shard set | crosshost-worker |

Standalone (non-sharded) does **not** emit these.

---

## Cross-Host

| Event | Payload | When | Modes |
|-------|---------|------|-------|
| `crosshost.storage.gate.passed` | `{ at }` | SQLite/file primary rejected; gate OK | crosshost |
| `crosshost.claim.acquired` | `{ fingerprint }` | Orchestrator Redis claim held | crosshost-orch |
| `crosshost.orchestrator.ready` | `{ totalShards; strategy; snapshotVersion }` | Control plane listening | crosshost-orch |
| `crosshost.worker.registered` | `{ machineId; assignedShards; totalShards }` | Register accepted | crosshost-worker |
| `crosshost.heartbeat.started` | `{ machineId; intervalMs }` | Early heartbeat loop started | crosshost-worker |
| `crosshost.snapshot.applied` | `{ version; mode: 'full'\|'diff'; hash? }` | Snapshot full/diff applied | crosshost-worker |
| `crosshost.assignment.applied` | `{ machineId; previous; next; reason; generation }` | Worker applied assignment | crosshost-worker |
| `crosshost.identify.granted` | `{ machineId; shardId; allowResume }` | Identify grant issued | crosshost-orch |
| `crosshost.rebalance` | `{ strategy; moves; reason }` | Rebalance proposal | crosshost-orch |
| `crosshost.worker.dead` | `{ machineId; ageMs }` | Worker removed after dead grace | crosshost-orch |
| `crosshost.plugin_bus.started` | `{ machineId }` | Inter-worker plugin bus up | crosshost-worker |

---

## Audit / errors

| Event | Payload | When | Modes |
|-------|---------|------|-------|
| `audit.recorded` | `AuditRecord` | Audit insert succeeded | all |
| `error.recorded` | `ErrorOccurrence` | Error store insert succeeded | all |

---

## Reserved / optional emit sites

These appear in `EventArgsMap` for forward compatibility; emit when the corresponding code path is instrumented:

- `config.reloaded`, `lang.reloaded`, `emoji.loaded`, `emoji.synced`
- `plugin.disabled`, `plugin.preload.complete`
- `interaction.handled`

Listeners may register early; zero listeners is always safe.

---

## Related

- [CROSS_HOST.md](CROSS_HOST.md) — multi-host control plane  
- [LOADER.md](LOADER.md) — plugin load order  
- [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) — plugin contracts including EventBus  
- Source of truth: `src/core/manager/events/EventBus.ts` (`EventArgsMap`)

## Command structure

| Event | When | Payload |
|-------|------|---------|
| `commands.structure.freeze` | After plugin boot, before/at sync barrier | `{ roots, at }` |
| `commands.structure.resync` | After `resyncApplicationCommands` | `{ guildId, at, tree }` |

## Permissions hierarchy & role links (Phase 4–5)

| Event | When | Shape (summary) |
|-------|------|-----------------|
| `permissions.hierarchy.denied` | Moderation target blocked by Discord or rank hierarchy | `{ actorUserId, targetUserId, guildId, action, code, at }` |
| `permissions.role_link.linked` | Discord role linked to perm role | `{ scope, guildId, discordRoleId, permRoleId, createdBy, at }` |
| `permissions.role_link.unlinked` | Link removed | `{ scope, guildId, discordRoleId, permRoleId, at }` |
| `commands.structure.freeze` | Command tree frozen after boot | `{ roots, at }` |
| `commands.structure.resync` | Application commands resynced | `{ guildId, at, tree }` |
