# Integrity

Zene package integrity signs and verifies plugin (and core) file trees so tampered code cannot load unnoticed.

## What is hashed

`IntegrityScanner.discoverFiles` walks a package root and records SHA hashes for every included file. Directory names in the exclude set are skipped entirely: `.git`, `node_modules`, `dist`, `.data`, `logs`, `configuration`.

Under any path segment named `data`, **only** these subtrees are included:

| Path | Why |
|------|-----|
| `data/schema/**` | Zod (or equivalent) schemas are **dynamically imported** at runtime for config/lang validation |
| `data/rules/**` | Validation rule modules are **dynamically imported** the same way |

Everything else under `data/` (for example `data/configuration`, emoji assets) is **not** hashed so normal runtime mutation does not fail verify.

## Import guard

`src/core/validation/resolve.ts` calls `assertDataCodePath` before any dynamic `import()` of a module path that contains `/data/`. Paths that are not under `/data/schema/` or `/data/rules/` throw; the failure is not swallowed by the import error handler.

## Pack and verify

- `PackageManager.pack` / `unpackAndVerify` (`manifest.nvx`) use the same scanner.
- `IntegrityManager.generate` / `verify` (`manifest.bin`) likewise.
- After changing schema or rules, **repack** signed plugins so manifests include the new hashes.

## Unsigned / bypass risk

If a plugin has no valid `manifest.nvx` verification and unsigned loading is allowed (whitelist / `allowUncertified`), files are loaded from `manifest.json` **without** cryptographic guarantees. Production should keep unsigned plugins disabled.

## Related code

- `src/core/helpers/integrity/scanner.ts`
- `src/core/helpers/integrity/manifest.ts`
- `src/core/helpers/integrity/manager.ts`
- `src/core/validation/resolve.ts`
- `src/core/loader/index.ts` (pack verify at load)

## Operational note

Existing manifests built before schema/rules were included in the hash set must be regenerated (`npm run pack` / PackageManager) or verify will report unauthorized additions under `data/schema` and `data/rules`.


## ignoreHash

Optional list of package-relative paths excluded from hashing and verification.

- Declared on plugin `manifest.json` as `"ignoreHash": ["path/to/file.ts", ...]` and embedded in `manifest.nvx` FlatBuffer field `ignore_hash` on the integrity payload.
- Pack: listed paths are not scanned / not written as `FileEntry` rows.
- Verify: listed paths are skipped; missing `ignore_hash` on older packages is treated as an empty list.
- Paths must be relative to the package root, use `/` separators, and must not contain `..`.
- After changing `ignoreHash` or ignored files, **repack** the plugin.

FlatBuffer schema: `src/core/flatbuffer/integrity.fbs` (re-run flatc after schema edits).
