# Auto-Updater

Manual-first update system for core and first-party plugins. Not exposed over HTTP.

See also: [README.md](README.md) · [SETUP.md](SETUP.md)


## Modes

| Mode | Behavior |
|------|----------|
| CLI `npm run updater` | Explicit plan/apply with flags (`--dry-run`, `--force`, `--baseline-only`, `--install-plugin`) |
| Background | May **check/notify** only; apply + process exit requires explicit opt-in (`UpdaterBackgroundApply`, default **false**) |

## Pipeline

1. Resolve target tag(s) (core `vX.Y.Z`; plugins `plugin-<id>-v*`)
2. Plan adds/updates/skips (manifest `zene_version`, SafeUpdate baseline)
3. Stage archives under a temp tree
4. **Backup** every path that apply will overwrite
5. Apply with journal marker (crash-safe)
6. Write baseline hashes
7. Restart process so new `core/` is loaded

## Crash safety

- Journal / update-in-progress marker on disk
- Incomplete apply → **boot recovery** restores from **local backup first** (network re-download only as fallback)
- Core apply uses dir-swap (`core` → `core.old`, staged → `core`) at a safe point before exit-for-restart
- Restore is idempotent: re-running recovery converges; marker remains until success
- Failed core backup **aborts** apply (never overwrite without backup)

## Actor

Apply is boot/CLI/system only. Audit records `updater.apply` as `system` when emitted.

## Related

- [ENV Reference.md](ENV%20Reference.md) — updater variables
- [README.md](README.md) — short summary


## Dashboard status (read-only)

`GET /api/dash/admin/updater/status` (session + **bot.owner**) returns `UpdaterStatusDto` from baseline/receipts/package metadata. **No HTTP apply or trigger** — apply remains CLI (`npm run updater`) / explicit background opt-in only.

## Packaging excludes

Hard excludes (updater walk/copy + release zips) include: `node_modules`, `.git`, **`.github`**, `.data`, `logs`, `configuration`, coverage, `.turbo`, `.nx`, `.env*`, IDE folders. Slim/Bundled source zips also exclude `.github/*` and `.env*`.
