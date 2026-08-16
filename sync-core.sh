#!/bin/bash
# sync-core.sh – Update core files on the current plugin-* branch
# Does NOT touch or remove the plugin you are working on.
# Only syncs core paths + sibling plugins that EXIST on the core tag.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✅${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
err()   { echo -e "${RED}❌${NC} $1"; exit 1; }

# ──────────────────────────────────────────────
# 1. Must be on a real plugin branch
# ──────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ ! "$CURRENT_BRANCH" =~ ^plugin- ]]; then
  err "You must be on a 'plugin-*' branch (current: $CURRENT_BRANCH)"
fi

if [ "$CURRENT_BRANCH" = "plugin-template" ]; then
  err "Do not run this on plugin-template."
fi

PLUGIN_NAME=${CURRENT_BRANCH#plugin-}
PLUGIN_DIR="src/plugins/$PLUGIN_NAME"

if [ ! -d "$PLUGIN_DIR" ]; then
  err "Plugin directory not found: $PLUGIN_DIR"
fi

info "Branch : ${CYAN}${CURRENT_BRANCH}${NC}"
info "Plugin : ${CYAN}${PLUGIN_NAME}${NC}"

# ──────────────────────────────────────────────
# 2. Dirty tree check
# ──────────────────────────────────────────────
STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  warn "Uncommitted changes:"
  git status -sb
  echo
  if [ "${1:-}" = "--stash" ] || [ "${1:-}" = "-s" ]; then
    info "Stashing..."
    git stash push -u -m "sync-core auto-stash $(date +%Y-%m-%d_%H:%M)"
    STASHED=true
  else
    err "Working tree dirty. Commit/stash first, or re-run with --stash"
  fi
else
  ok "Working tree clean"
fi

# ──────────────────────────────────────────────
# 3. Fetch + resolve latest core tag
# ──────────────────────────────────────────────
info "Fetching tags..."
git fetch origin --tags --prune

LATEST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -n1)
if [ -z "$LATEST_TAG" ]; then
  err "No release tags (v*) found."
fi
info "Latest core tag: ${CYAN}${LATEST_TAG}${NC}"

# Fast-path: .core-version already records this tag. (We sync paths, not the
# tag commit itself, so a merge-base ancestry check is meaningless here — the
# recorded marker is the correct signal.)
if [ -f .core-version ] && [ "$(cat .core-version)" = "$LATEST_TAG" ]; then
  ok "Already on $LATEST_TAG (per .core-version) – nothing to do."
  [ "$STASHED" = true ] && warn "Stash present → git stash pop"
  exit 0
fi

# ──────────────────────────────────────────────
# 4. Protect current plugin (backup) + restore-on-ANY-exit trap
# ──────────────────────────────────────────────
BACKUP_DIR=$(mktemp -d)
info "Backing up your plugin → $BACKUP_DIR/$PLUGIN_NAME"
cp -a "$PLUGIN_DIR" "$BACKUP_DIR/$PLUGIN_NAME"

# If ANYTHING below fails, restore the plugin before exiting so we never leave
# the working tree with the plugin deleted. Cleared on success in step 6.
RESTORE_ON_EXIT=true
cleanup() {
  if [ "${RESTORE_ON_EXIT:-false}" = true ] && [ -d "$BACKUP_DIR/$PLUGIN_NAME" ]; then
    warn "Aborting — restoring your plugin from backup."
    rm -rf "$PLUGIN_DIR"
    mkdir -p "$(dirname "$PLUGIN_DIR")"
    cp -a "$BACKUP_DIR/$PLUGIN_NAME" "$PLUGIN_DIR"
  fi
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

# Remember any other local-only plugins so we never delete them
# (portable: macOS ships bash 3.2 which lacks `mapfile`)
LOCAL_PLUGINS=()
while IFS= read -r line; do
  [ -n "$line" ] && LOCAL_PLUGINS+=("$line")
done < <(ls -1 src/plugins/ 2>/dev/null || true)

# ──────────────────────────────────────────────
# 5. Bring in core files from the tag (path checkout, NOT a full merge)
# ──────────────────────────────────────────────
# Adjust this list if your core layout differs.
CORE_PATHS=(
  package.json
  package-lock.json
  tsconfig.json
  typedoc.json
  src/core
  src/index.ts
  src/index.d.ts
  common.json
  configuration
)

info "Checking out core paths from $LATEST_TAG ..."
MISSING_PATHS=()
for path in "${CORE_PATHS[@]}"; do
  if git cat-file -e "$LATEST_TAG:$path" 2>/dev/null; then
    # Remove first so files deleted upstream don't linger, then take the tag's copy.
    rm -rf "$path"
    git checkout "$LATEST_TAG" -- "$path"
    echo "  • $path"
  else
    MISSING_PATHS+=("$path")
  fi
done

# Loudly flag declared core paths that no longer exist on the tag — this is how
# a core restructure silently stops being synced.
if [ "${#MISSING_PATHS[@]}" -gt 0 ]; then
  warn "These CORE_PATHS were NOT found on $LATEST_TAG (core may have moved them):"
  for p in "${MISSING_PATHS[@]}"; do echo "     - $p"; done
  warn "Update CORE_PATHS in sync-core.sh if the core layout changed."
fi

# Update ONLY sibling plugins that exist on the tag,
# never touch the current plugin, never delete local-only ones.
if git cat-file -e "$LATEST_TAG:src/plugins" 2>/dev/null; then
  info "Updating sibling plugins present on tag (skipping $PLUGIN_NAME)..."
  TAG_PLUGINS=()
  while IFS= read -r line; do
    [ -n "$line" ] && TAG_PLUGINS+=("$line")
  done < <(git ls-tree --name-only "$LATEST_TAG:src/plugins" 2>/dev/null || true)
  for p in "${TAG_PLUGINS[@]}"; do
    if [ "$p" = "$PLUGIN_NAME" ]; then
      continue   # never overwrite the plugin we're developing
    fi
    # Clean checkout: remove stale files, then take the tag's version.
    rm -rf "src/plugins/$p"
    git checkout "$LATEST_TAG" -- "src/plugins/$p"
    echo "  • src/plugins/$p"
  done
fi

# ──────────────────────────────────────────────
# 6. Restore current plugin (guaranteed) + disarm trap
# ──────────────────────────────────────────────
rm -rf "$PLUGIN_DIR"
mkdir -p "$(dirname "$PLUGIN_DIR")"
cp -a "$BACKUP_DIR/$PLUGIN_NAME" "$PLUGIN_DIR"
ok "Restored your plugin: src/plugins/$PLUGIN_NAME"

# Success path: don't let the trap "restore" over our good state; just clean up.
RESTORE_ON_EXIT=false
rm -rf "$BACKUP_DIR"
trap - EXIT

# Ensure no local-only plugins were removed
for p in "${LOCAL_PLUGINS[@]}"; do
  if [ ! -d "src/plugins/$p" ]; then
    warn "Local plugin missing after sync (should not happen): $p"
  fi
done

# ──────────────────────────────────────────────
# 7. Record core version + commit
# ──────────────────────────────────────────────
echo "$LATEST_TAG" > .core-version
git add -A

if git diff --cached --quiet; then
  ok "Already fully synced to $LATEST_TAG"
else
  git commit -m "chore: sync core to $LATEST_TAG (keep plugin $PLUGIN_NAME)"
  ok "Committed core sync → $LATEST_TAG"
fi

warn "Run:  npm ci   (or npm install)  to refresh dependencies"

if [ "$STASHED" = true ]; then
  echo
  warn "Your previous changes are in the stash."
  info "Restore with:  git stash pop"
fi

ok "Done. Core updated, your plugin untouched."
