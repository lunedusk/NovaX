# Cache Registry & Façade

## Façade

`cacheFacade` — Redis alias if available, else process-local `TTLCache`. Subsystems pick alias chains (e.g. cooldown: `cooldown` → `redis` only; never silent main for rate limits).

KV and rate-limit local maps are **split** so a Redis blip cannot corrupt cooldown counters.

## Registry

Every `TTLCache` registers itself at construction (`name` + instance). `/admin cache-list` and `cache-pop` enumerate the live registry (autocomplete). Guild-gate presence `Map` is **not** a TTLCache and is not poppable.

Pop is **per-process** (multi-shard: only the handling shard clears).

## Related

- [ENV Reference.md](ENV%20Reference.md) — Redis aliases