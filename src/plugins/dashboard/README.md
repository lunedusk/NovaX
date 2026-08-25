# Dashboard API Plugin

Implements every endpoint in the spec as a NovaX plugin (`plugins/dashboard/`).
All 85 routes across the 10 sections are wired up, secured, and audit-logged.

## Dependencies

```json
"dependencies": ["api", "permissions", "token"]
```

- **`api`** — gateway plugin. `applyGateway()` in `src/lib/authz.ts` calls its
  `GatewayManager.applyMiddleware(router)` on every dashboard router
  (security headers, CORS, and the gateway's own static-API-key bearer auth
  via `Authorization: Bearer <key>`).
- **`token`** — issues/verifies the *user* session tokens used by this
  plugin. See "Two auth layers" below.
- **`permissions`** — resolves permission bits and owns bot-wide/server role
  CRUD (`listBotRoles`, `createServerRole`, etc). The dashboard does **not**
  keep its own parallel role table — `/api/dash/admin/roles/*` and
  `/api/dash/servers/:guildId/roles/*` drive this plugin directly.

## Two auth layers

1. **Gateway (app-level)** — every request must carry
   `Authorization: Bearer <api-key>`, checked by `GatewayConfigManager`
   against its configured key list / master key. This gates "is this client
   allowed to hit the API at all."
2. **Session (user-level)** — `POST` isn't used for `/auth/resolve` (kept
   `GET` per the spec) but the caller supplies `X-Discord-Access-Token`
   (their Discord OAuth token) and `X-Dash-Device-Id`. The route verifies
   the Discord token, then calls the **real** `token` plugin's
   `issueWithResolvedBits(userId, guildId, { deviceId, ... })`, which
   internally resolves the user's permission bits via
   `permissionsManager.cachedResolve()` and returns a signed token string.
   Every subsequent authenticated dashboard call carries that token in
   `X-Dash-Session` (deliberately **not** `Authorization`, to avoid
   colliding with the gateway's own bearer key). `src/lib/authz.ts` verifies
   it via `token.manager.verify()` and checks bits with
   `token.manager.hasBit(verified, bit)` — bits live at
   `verified.payload.bits`, user id at `verified.payload.userId`, etc.
   (`VerifiedToken` is `{ payload: {...} }`, not flat.)

Bot Owner routes require the specific `bot.*` bit; Server-Scoped routes
require the `server.*` bit **for that guild** OR the bot-wide equivalent
(`requireGuildBit`'s `crossServerBit` param) OR the synthetic `bot.owner`
bit, which always passes.

## Storage

- **SQLite** (`this.heart.db.sqlite.get('main')`, tables created in
  `onSetup()` via `src/lib/db.ts`): server bans, member notes, theme +
  presets, landing-page config, GDPR deletion requests, per-guild lang
  overrides, bot-wide member bans.
- **NovaDB** (`dash_infractions`, `dash_audit_log`, `dash_command_counters`
  collections, indexed on `guildId`/`userId`/`date`): append-heavy data —
  infractions, the audit log (every mutating action writes here, per the
  spec's logging requirement), and command-usage counters for analytics.
- **Role CRUD** is *not* stored by this plugin — see above, it's delegated
  to `permissions`.

## Corrections made after seeing the real core source

The first draft of this plugin had to guess at several undocumented core
APIs. You then shared the actual `permissions`, `token`, and `api`-gateway
handler/route source, which corrected three things:

1. There is a real **`token` plugin** with its own `TokenHandler`
   (`issue`, `issueWithResolvedBits`, `verify`, `refresh`, `revokeAll`,
   `revokeDevice`, `hasBit`, `listDevices`) and its own REST surface at
   `/api/tokens/*`. The dashboard no longer instantiates its own
   `TokenManager` — `src/handlers/session.ts` was deleted; `src/lib/tokens.ts`
   is a thin typed accessor for `this.heart.system.handler.token.manager`.
2. `VerifiedToken` is `{ payload: { userId, bits, guildId?, deviceId,
   deviceLabel?, iat, exp, iss, aud } }` — every `req.dashSession!.userId`
   etc. became `req.dashSession!.payload.userId`.
3. `PermissionsHandler`'s real role methods are `listBotRoles`,
   `createBotRole`, `updateBotRole`, `deleteBotRole`, `assignBotRole`,
   `revokeBotRole` (+ `...ServerRole` variants) — there is **no** singular
   `getBotRole(id)`. `GET /api/dash/admin/roles/:roleId` therefore calls
   `listBotRoles()` and finds the match client-side
   (`src/lib/roles.ts::findBotRole`). The exact field names on
   `BotWideRoleDoc`/`CreateBotRoleInput` (from `#core/types/permissions.js`)
   weren't shown, so the create/update calls pass `{ name, color?, bits? }`
   cast `as never` at the call site — **if the real input type differs,
   only `adminRoles.ts` and `serverScoped.ts`'s role handlers need
   updating**, everything downstream (audit logging, HTTP layer) is
   unaffected.

## Second correction pass: real PluginManager + real permission bits

You then shared the actual `PluginManager` (`#core/loader/index.js`) and
`#core/types/permissions.js`. Corrections made:

1. **`PluginManager` has no `list/get/enable/config/lang` methods.** Its real
   public surface is just `registry: Map<string, BasePlugin>` (only
   *currently loaded* plugins — a disabled/failed one won't appear, and
   there's no public accessor for the private `bootStatuses` map), plus
   `disable(id)`, `reload(idString, client)`, `shutdownAll()`. There is no
   `enable()` — "enable" is implemented as `reload()`, since its own logic
   already skips the disable step when the plugin isn't currently
   registered. This is now split into two files:
   - `src/lib/pluginLifecycle.ts` — 100% grounded in the real API
     (list/get/enable/disable/reload derived from `registry` + `disable`/`reload`).
   - `src/lib/pluginConfig.ts` — config/lang CRUD. `#core/manager/config.js`
     (`configManager`) and `#core/manager/lang.js` (`i18n`) are *confirmed
     to exist* (the real `reload()` imports and calls `.reloadAll()` on
     both), but their per-plugin get/set/schema/locale method names are
     still assumed — flagged inline, isolated to this one file.
   - **Known limitation** (inherent to the real API, not a bug): `GET
     /api/dash/plugins` and plugin detail can only report plugins that are
     currently loaded/enabled.

2. **`ResolvedPermissions.bits` is a `ReadonlySet<string>`, not an array.**
   `GET /api/dash/auth/permissions` was serializing straight to
   `res.json(resolved)`, which would have silently collapsed `bits` to
   `{}` under `JSON.stringify`. Fixed by spreading to an array before
   responding (`auth.ts::permissionsFor`).

3. **Real `BUILT_IN_BITS` differs substantially from the first draft's
   invented bit names** — rewrote `src/lib/bits.ts` to copy the seed list
   verbatim. Notably: no generic `bot.members.manage` / `server.members.manage`
   (there are separate `kick`/`ban`/`mute`/`ban_global` bits instead — fixed
   across `adminMembers.ts` and `serverScoped.ts`); a dedicated
   `bot.plugins.reload` distinct from `bot.plugins.manage`; a dedicated
   `bot.dash.pages.manage` distinct from `bot.theme.manage` (landing-page
   content vs. theme tokens are different permissions — fixed in
   `adminTheme.ts`); `server.members.history` for the infractions
   endpoints (previously reusing `server.members.view`). Two dashboard
   capabilities have no built-in equivalent at all — cross-server member
   notes and infraction deletion — so they're registered as genuine
   `plugin.dashboard.*` custom bits via `permissions.manager.registerBit()`
   in `index.ts::onSetup()` (the framework's documented mechanism for
   plugin-specific bits; `ServerRoleDoc.bits` accepts `plugin.*` bits too,
   so these work at both scopes). `server.lang.manage` also has no bot-wide
   equivalent bit, so the lang-override routes rely on the per-guild bit
   (or the `bot.owner` bypass) with no `crossServerBit`.

4. **`CreateBotRoleInput`/`CreateServerRoleInput` require `color` and
   `createdBy`** (not optional, as first guessed) — role-creation endpoints
   in `adminRoles.ts`/`serverScoped.ts` now require `color` in the request
   body and pass `createdBy: req.dashSession!.payload.userId`. Role docs
   use `_id` (not `id`) — `src/lib/roles.ts::findBotRole/findServerRole`
   simplified accordingly.



If you can share these files too, I'll reconcile the same way:

- **Analytics data source** (`src/handlers/analytics.ts`) — command-per-day
  counters are self-tracked in a `dash_command_counters` NovaDB collection,
  fed either by other plugins calling
  `heart.system.handler.dashboard.analytics.recordCommand(pluginId, cmd)`
  directly, or a best-effort `command:executed` event subscription in
  `index.ts` (inert if that event name doesn't exist). If there's a real
  `#core/manager/metrics/index.js` API, analytics should read from that
  instead.
- **Global (bot-wide) member ban** — `POST .../ban-global` and the "global"
  sentinel in `POST .../unban`'s `guildIds` array are a dashboard-specific
  extension (own `dash_global_member_bans` table) since the spec doesn't
  define how a global ban should be storable/reversible.
- **`/api/dash/public/*` needs a config change you make once**: add these
  three paths to `auth.publicPaths` in the `api` plugin's
  `configuration/api.json5` so anonymous visitors can hit them without a
  gateway API key. Documented inline in `src/routes/public.ts`.
- **Member search** (`GET /api/dash/admin/members`) only scans
  `guild.members.cache` (i.e. gateway-cached members), noted inline in
  `adminMembers.ts`.
- **`GET /api/dash/plugins/registry`**'s "page bundle" concept (per-plugin
  dashboard-frontend JS module) has no source anywhere — reads an ad-hoc
  `manifest.dashboard.pageBundleUrl` field that doesn't exist unless a
  plugin author adds it.

## Third correction pass: real ConfigManager + LanguageManager

You then shared the actual `ConfigManager` (`#core/manager/config.js`) and
`LanguageManager` (`#core/manager/lang.js`). The big finding: **neither has
a write method.** Both are pure read+reload caches over JSON5 files on
disk:

- `ConfigManager`: `get(name)` / `getStrict(name)` / `has(name)` /
  `getLoadedConfigs()` / `reloadFile(name)` / `reloadAll()` — no `set`, no
  schema concept at all.
- `LanguageManager`: `getNamespace(ns, locale)` (returns **compiled
  functions**, not editable raw content) / `get(ns, key, vars, locale)` /
  `getLoadedNamespaces()` / `reloadFile(ns, locale)` / `reloadAll()` /
  `wipeCache(locale?)` — no `set`/`create`/`delete`.

`src/lib/pluginConfig.ts` was rewritten around this reality:

1. **Every mutation writes the JSON5 file directly** (`fs.writeFile`) to
   `configuration/<pluginId>-config.json5` (config) or
   `configuration/lang/<pluginId>_<locale>.json5` (lang — this exact
   pattern is now *confirmed* by `LanguageManager.parseFilename`'s
   `namespace_locale.json5` split), then calls the real `reloadFile()` to
   refresh the cache. The `-config` suffix on the config filename is still
   an inference (grounded in the framework doc's
   `configuration/<plugin_id>-<name>.json5` pattern plus the fact a plugin
   only ever ships one `config.json5`).
2. **Config schema** (`GET .../config/schema`) has no real backing at all
   — there is no schema concept anywhere in `ConfigManager`. It's now
   derived by reading the plugin's own default
   `data/configuration/config.json5` and inferring `{key, type, default}`
   per top-level key. This is a best-effort approximation, not a real
   schema, and won't reflect nested validation rules a plugin author might
   have intended.
3. **Config reset** re-reads that same plugin default file and writes it
   over the live config, then reloads — there's no dedicated "reset" verb
   in the core.
4. **Locale delete** has a real gap: `LanguageManager`'s only removal path
   is its *private* `unloadPath()`, fired by the file watcher's `deleted`
   event — which only exists if `hotReload: true` was passed to `init()`.
   To reliably purge a deleted locale regardless of that, `deletePluginLocale()`
   deletes the file then calls `wipeCache(locale)` + `reloadAll()` (rebuilds
   that whole locale from whatever's left on disk — more expensive than a
   single-namespace unload, but the only way to guarantee correctness with
   the real public API).
5. **Server-scoped plugin config was de-fictionalized.** There is *no*
   per-guild concept anywhere in the real `ConfigManager` — it's a flat,
   bot-wide cache. Rather than keep pretending a `getForGuild`/`setForGuild`
   core API exists, `GET/PUT /api/dash/servers/:guildId/plugins/:pluginId/config`
   now read/write a dashboard-owned SQLite table
   (`dash_server_plugin_config`, added to `src/lib/db.ts`), the same
   pattern already used for server-scoped lang overrides. **This is
   flagged clearly in `serverScoped.ts` as dashboard bookkeeping only** —
   nothing in the framework makes a target plugin automatically consult
   this table, so it's a staged/proposed override rather than a live one
   until such a hook is built.

## Fourth pass: verification, batching + rate limiting, and two real bugs fixed

You asked me to verify the plugin lifecycle endpoints specifically, batch
enable/disable, and rate-limit them (30s) since Discord throttles
application-command resyncs after every reload. Doing that surfaced two
real bugs beyond the design gap:

**Bug 1 — a doc-comment in `src/lib/roles.ts` broke the file.** The
comment read `list*/create*/update*/delete*/assign*/revoke*` — the `*/`
inside "list*/create" is a literal block-comment terminator, so the
comment closed early and the rest of that sentence became invalid,
unparseable code (confirmed by actually running `tsc` against every file
in this plugin, which is how it was caught). Fixed by rewording the
comment to use spaces instead of `*/`. I ran a project-wide grep afterward
for the `word*/word` pattern to confirm it was the only instance, then
re-ran `tsc --noEmit` over every file to confirm no other file has a
syntax error.

**Bug 2 — cooldown consumed before request validation.** The first version
of `assertLifecycleCooldown()` ran *before* validating the incoming
`pluginIds` list, so a malformed request (empty array, or an attempt to
disable `dashboard` itself) would still burn a valid 30-second window for
nothing. Reordered so `dedupe()`/self-disable-guard run first and the
cooldown is only consumed once the request is known-good.

**Design change — batching + the 30s cooldown** (`src/lib/pluginLifecycle.ts`):

- `POST .../enable`, `.../disable`, and `.../reload` now all accept an
  optional JSON body `{ "pluginIds": ["other-plugin", "..."] }`, merged
  with the URL's `:pluginId` into one deduped batch — the URL param still
  works standalone exactly as the original spec describes, this is purely
  additive.
- **Why batching matters, concretely**: the real `reload()` does
  `interactionHandler.syncCommands()` exactly ONCE per call, regardless of
  how many `$`-joined ids are in the batch. `enable`/`reload` now always
  route through one `reload()` call for the whole list — three separate
  single-plugin `enable` calls would trigger three Discord resyncs; one
  batched call triggers one.
- `disable()` has no native batching in the real API (single id only, and
  per its own source it never calls `syncCommands()` at all), so batched
  disables loop sequentially — but the whole batch is still gated by a
  single cooldown check, and a partial-failure batch returns
  `{ success: [...], failed: [...] }` per id, all individually audit-logged.
- **Shared 30-second cooldown** across all three actions, process-local
  (resets on dashboard restart), returned as `429 rate_limited` with a
  `Retry-After` header and a `retryAfterMs` detail in the JSON error body
  when triggered too soon.
- **Fixed the previously-documented "known limitation"**: `GET
  /api/dash/plugins` and plugin detail now also scan `plugins/*/manifest.json`
  on disk (best-effort, no signature verification) and merge in
  loaded/enabled state from the real registry — so disabled/not-yet-booted
  plugins are listed too, not just currently-loaded ones. The narrow
  residual gap: a certified `.nvx`-only plugin with no `manifest.json`
  fallback, while currently disabled, still won't appear (nothing to read).
- Config/lang endpoints no longer require "currently loaded" at all (see
  `assertKnownPlugin`) — they only need the plugin to be known (on disk or
  in the registry), since config/lang files persist independent of a
  plugin's running state. This was a real bug in the previous version: it
  would have blocked editing a disabled plugin's config until re-enabled.



## Env vars

- `TokenMasterSecret` (used by the `token` plugin, ≥32 chars) — the
  dashboard no longer needs its own secret.
- Standard `BotOwnerIds` for the synthetic `bot.owner` bit (per the
  permissions system doc).

## File map

```
plugins/dashboard/
├── manifest.json
├── index.ts                        onSetup: schema init; onEnable: analytics event wiring
├── data/configuration/
│   ├── config.json5
│   └── lang/en.json5
└── src/
    ├── handlers/
    │   └── analytics.ts            command-usage counters (see assumption above)
    ├── lib/
    │   ├── authz.ts                gateway + session middleware, requireBit/requireGuildBit
    │   ├── bits.ts                 permission-bit constants
    │   ├── db.ts                   SQLite schema + NovaDB collections, audit log writer
    │   ├── discord.ts              discord.js moderation action wrappers
    │   ├── http.ts                 response envelope, pagination, guarded() error handling
    │   ├── pluginLifecycle.ts      real PluginManager wrapper: disk+registry listing, batch enable/disable/reload, 30s cooldown
    │   ├── pluginConfig.ts         fs-backed config/lang CRUD (writes JSON5 + reloadFile/reloadAll)
    │   ├── roles.ts                real permissions-plugin role accessor
    │   └── tokens.ts                real token-plugin accessor
    └── routes/
        ├── auth.ts                 /api/dash/auth/*        (3)
        ├── public.ts                /api/dash/public/*      (3)
        ├── adminServers.ts          /api/dash/admin/servers/*  (5)
        ├── adminMembers.ts          /api/dash/admin/members/*  (12)
        ├── adminPlugins.ts          /api/dash/plugins/*        (15)
        ├── adminRoles.ts            /api/dash/admin/roles/*    (7)
        ├── adminTheme.ts            /api/dash/admin/theme/*, /api/dash/admin/public/landing-config (7)
        ├── adminAnalytics.ts        /api/dash/admin/analytics/*, /api/dash/admin/logs (4)
        ├── serverScoped.ts          /api/dash/servers/:guildId/*  (23)
        └── me.ts                    /api/dash/me/*             (6)
```

**Total: 85 endpoints**, matching the spec exactly.
