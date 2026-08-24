# Audit Registry

Append-only action log for privileged operations. Multi-engine via backend selector (sqlite → postgres → mongo).

## Record shape

`id`, `actorType` (`user` | `api_key` | `system`), `actorId`, `action`, `target`, `outcome` (`success` | `fail`), `reason`, `meta` (allow-listed names/ids/counts only), `createdAt`.

Secret values (tokens, keys, bodies) are never stored. Token refresh targets subject + jti only.

## Emission

Wired at action sites (token issue/refresh/revoke, permission bits/roles, gates, admin reload/cache-pop, updater apply). Non-blocking: failed writes log and continue (`Audit.failClosed` default false).

Event bus: typed `audit.recorded`.

## Read surface

| Surface | Gate |
|---------|------|
| `GET /api/audit`, `GET /api/audit/:id` | `bot.audit.view` |
| `/admin audit-list`, `audit-get` | Owner admin gate |

Reading the audit log is not itself audited.

## Related

- [ERRORS.md](ERRORS.md)
- [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md)
