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
