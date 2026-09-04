# Error Registry

Central taxonomy (`NovaError`) plus a **coalesced** durable occurrence store.

## NovaError

Stable `code` (e.g. `TOKEN.TOKEN_EXPIRED`, `AUTH.INVALID_KEY`), `category`, `severity`, `userMessage` (client-safe), `statusCode`, optional `details` (logger only).

High-value throws in token / permission / gateway boot use `NovaError` subclasses (`TokenError`, `PermissionError`).

## Boundaries

- **HTTP:** NovaError → status + `{ error, code, message: userMessage }`; unknown → generic 500. Persist via `errors.record` with allow-listed context (`method`, route pattern, `code`, `status`, actor) — never body/headers/query/authorization.
- **Interactions:** ephemeral userMessage / generic; same persist rules.
- **Gateway auth failures:** direct `res.status` (no throw) **plus** fire-and-forget `errors.record` (`AUTH.*` / `GATEWAY.*`).

## Coalescing

Occurrences with the same `code` within a time window upsert one row: `count`, `firstSeen`, `lastSeen`. Prevents flood from key spam. Store failures are log-only (non-reentrant).

## Read surface

| Surface | Gate |
|---------|------|
| `GET /api/errors`, `GET /api/errors/:id` | `bot.errors.view` |
| `/admin error-list`, `error-get` | Owner admin gate |

List/get expose coalesce fields. Reads do not call `errors.record`.

## Related

- [AUDIT.md](AUDIT.md)
- OpenAPI: `/api/openapi.json`


## Export

`GET /api/dash/admin/errors/export?format=json|csv` (bit **bot.errors.view**) — coalesced occurrence fields only (already secret-safe context).

## Discord action errors

Plugin-facing classifier and CV2 replies live in `plugins/core/src/lib/discordActionErrors.ts`.

| Code | Meaning |
|------|---------|
| `permission_denied` | Discord / generic permission failure |
| `missing_bit` | Zene permission bit missing (`{{bit}}`) |
| `hierarchy` | Role hierarchy blocks the action |
| `target_is_owner` | Target holds `bot.owner` |
| `target_is_bot_protected` | Target holds `bot.protected` |
| `target_is_server_protected` | Target holds `server.protected` |
| `target_is_self` | Actor targeted themselves |
| `target_is_bot` | Action illegal on bots (e.g. timeout) |
| `bot_missing_perms` | Bot lacks Discord channel/guild permission |
| `not_in_guild` | Guild not on this process / bot not in guild |
| `unknown_member` / `unknown_guild` / `unknown_role` / `unknown_channel` / `unknown_user` | Missing entities |
| `rate_limited` | Discord or local rate limit |
| `api_error` | Other Discord API error (`{{code}}`, `{{message}}`) |
| `action_failed` | Generic failure (`{{reason}}`) |
| `invalid_duration` / `invalid_target` | Bad input |
| `partial_failure` | Multi-guild batch partially succeeded |
| `not_available_here` | Wrong process mode |
| `fleet_unreachable` | Cross-Host control plane / peer unreachable |

Lang keys: `core` namespace `errors.discord.<code>` and `errors.discord.titles.<code>` (sentence case). Layout: `layouts.containerError`.

**Protection bits**

- `bot.protected` — bot-wide; assignable only by `bot.owner` (env owners assign `bot.owner` itself)
- `server.protected` — per-guild; assignable by `server.owner` / `server.roles.manage` / `bot.owner`

Interactions with `guildId` but no resolved guild attempt a cache/fetch soft-fail to `not_in_guild` (wrong worker / not a member).

## Core lang error codes

Plugin `core` lang keys under `errors.codes.*` and `errors.discord.*` (see `src/plugins/core/data/configuration/lang/en.json5`).

Helpers:

- `#plugins/core/src/lib/coreErrors.js` — `coreErrorMessage` / `coreErrorTitle`
- `#plugins/core/src/lib/discordActionErrors.js` — moderation / Discord action codes

Examples: `COMMAND_FAILED`, `PAGINATOR_EXPIRED`, `HIERARCHY_RANK`, `ROLE_BITS_MISSING`, `FORBIDDEN`.
