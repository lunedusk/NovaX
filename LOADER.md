# Config & Lang Loader Merge

ConfigLoader and LangLoader share one merge/write engine.

## Semantics

| Behavior | Rule |
|----------|------|
| Missing default keys | Added at any depth |
| User-only keys | **Kept** (not pruned) |
| User values | **Never overwritten** by defaults |
| Type mismatch | User value kept; validation reports the error; warn log |
| Arrays | User array kept wholesale (new default **entries** are not auto-injected) |
| Force-overwrite paths | None in v1 |

## Validation

After merge, Zod + rules run. A validation failure **does not** skip the additive write: missing framework keys still land on disk, and the error is logged loudly. Plugins may still be disabled at runtime if config remains invalid.

## Disk write

`writeJson5Preserving`:

1. Prefer **surgical** text insert of missing keys (preserves comments and key order).
2. **Round-trip gate:** parse the patched text and deep-equal against the intended object; commit only on match.
3. On mismatch or unreadable file → **wholesale** `JSON5.stringify` + warning that comments may be lost.

New files and corrupt-file recovery use wholesale only.

## Untagged rand (config only)

Config untagged `${rand:…}` persists by replacing the placeholder string in the existing file text (same round-trip gate). Lang has no untagged-rand disk persist.

## Related

- [PLACEHOLDERS.md](PLACEHOLDERS.md)
- [SETUP.md](SETUP.md)
