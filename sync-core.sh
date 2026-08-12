#!/bin/bash
# sync-core.sh – Update core files on the current plugin-* branch
# Does NOT touch or remove the plugin you are working on.
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
  STASHED=false
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

if [ -f .core-version ] && [ "$(cat .core-version)" = "$LATEST_TAG" ]; then
  if git merge-base --is-ancestor "$LATEST_TAG" HEAD 2>/dev/null; then
    ok "Already on $LATEST_TAG – nothing to do."
    [ "$STASHED" = true ] && warn "Stash present → git stash pop"
    exit 0
  fi
fi

# ──────────────────────────────────────────────
# 4. Protect current plugin (backup)
# ──────────────────────────────────────────────
BACKUP_DIR=$(mktemp -d)
info "Backing up your plugin → $BACKUP_DIR/$PLUGIN_NAME"
cp -a "$PLUGIN_DIR" "$BACKUP_DIR/$PLUGIN_NAME"

# Also remember any other local-only plugins so we never delete them
mapfile -t LOCAL_PLUGINS < <(ls -1 src/plugins/ 2>/dev/null || true)

# ──────────────────────────────────────────────
# 5. Bring in core files from the tag (not a full merge)
# ──────────────────────────────────────────────
# Adjust this list if your core layout differs
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
for path in "${CORE_PATHS[@]}"; do
  if git cat-file -e "$LATEST_TAG:$path" 2>/dev/null; then
    git checkout "$LATEST_TAG" -- "$path"
    echo "  • $path"
  fi
done

# Optional: update *sibling* plugins that exist on the tag,
# but never touch the current plugin and never delete local-only ones
if git cat-file -e "$LATEST_TAG:src/plugins" 2>/dev/null; then
  info "Updating sibling plugins from tag (skipping $PLUGIN_NAME)..."
  # List plugins that exist on the tag
  mapfile -t TAG_PLUGINS < <(git ls-tree --name-only "$LATEST_TAG:src/plugins" 2>/dev/null || true)
  for p in "${TAG_PLUGINS[@]}"; do
    if [ "$p" = "$PLUGIN_NAME" ]; then
      continue   # never overwrite the plugin we're developing
    fi
    git checkout "$LATEST_TAG" -- "src/plugins/$p"
    echo "  • src/plugins/$p"
  done
fi

# ──────────────────────────────────────────────
# 6. Restore current plugin (guaranteed)
# ──────────────────────────────────────────────
rm -rf "$PLUGIN_DIR"
cp -a "$BACKUP_DIR/$PLUGIN_NAME" "$PLUGIN_DIR"
ok "Restored your plugin: src/plugins/$PLUGIN_NAME"
rm -rf "$BACKUP_DIR"

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
git add .core-version

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