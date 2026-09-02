#!/bin/bash
# sync-core.sh – Sync a plugin to the latest core tag, in one of two modes.
#
# MODES
#   branch  (default) You are on a plugin-* branch INSIDE the core repo.
#                     Core = latest v* tag in THIS repo. Keeps your dev plugin
#                     + any branch-only plugins (present here, not in core).
#   repo              Your plugin lives in its OWN repo. Core = latest v* tag
#                     from a SEPARATE core repo (CORE_REPO=<url> or a git remote
#                     named 'core'). Keeps ALL of this repo's plugins; DROPS
#                     core's own plugins unless --with-core-plugins is given.
#
# ALWAYS
#   • Tracked tree is made identical to core (adds + updates + DELETES) …
#   • …except kept plugins, an optional KEEP_PATHS list, and a re-stamped
#     .core-version. Git-ignored / untracked files are never touched.
#   • Commits ONTO the current branch (linear history, no force-push).
#
# ENV
#   CORE_REPO   URL of the core repo (repo mode; alternative to a 'core' remote)
#   KEEP_PATHS  Extra space-separated tracked paths to preserve from HEAD
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()   { echo -e "${GREEN}✅${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}❌${NC} $1"; exit 1; }

# ──────────────────────────────────────────────
# 0. Parse args
# ──────────────────────────────────────────────
MODE="branch"; STASH_REQ=false; WITH_CORE_PLUGINS=false
for arg in "$@"; do
  case "$arg" in
    branch|repo)         MODE="$arg" ;;
    --stash|-s)          STASH_REQ=true ;;
    --with-core-plugins) WITH_CORE_PLUGINS=true ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) err "Unknown argument: $arg (try --help)" ;;
  esac
done

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "Mode   : ${CYAN}${MODE}${NC}"
info "Branch : ${CYAN}${CURRENT_BRANCH}${NC}"

# ──────────────────────────────────────────────
# 1. Mode-specific preconditions
# ──────────────────────────────────────────────
PLUGIN_NAME=""
if [ "$MODE" = "branch" ]; then
  if ! [[ "$CURRENT_BRANCH" =~ ^plugin- ]]; then
    err "branch mode must run on a 'plugin-*' branch (current: $CURRENT_BRANCH).
       For a standalone plugin repo, run:  sync-core.sh repo"
  fi
  if [ "$CURRENT_BRANCH" = "plugin-template" ]; then
    err "Do not run this on plugin-template."
  fi
  PLUGIN_NAME=${CURRENT_BRANCH#plugin-}
  [ -d "src/plugins/$PLUGIN_NAME" ] || err "Plugin directory not found: src/plugins/$PLUGIN_NAME"
  info "Plugin : ${CYAN}${PLUGIN_NAME}${NC}"
fi

# ──────────────────────────────────────────────
# 2. Working tree must be clean (or pass --stash / -s)
# ──────────────────────────────────────────────
STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet \
   || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  warn "Uncommitted changes:"
  git status -sb; echo
  if [ "$STASH_REQ" = true ]; then
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
# 3. Resolve + fetch the core tag (per mode)
# ──────────────────────────────────────────────
if [ "$MODE" = "branch" ]; then
  info "Fetching core tags from origin..."
  git fetch origin --tags --prune
  CORE_LABEL=$(git tag -l 'v*' --sort=-v:refname | head -n1)
  [ -n "$CORE_LABEL" ] || err "No release tags (v*) found in this repo."
  CORE_REF="$CORE_LABEL"
else
  CORE_SRC="${CORE_REPO:-}"
  if [ -z "$CORE_SRC" ]; then
    if git remote get-url core >/dev/null 2>&1; then
      CORE_SRC="core"
    else
      err "repo mode needs the core repo. Either:
       • set CORE_REPO=https://github.com/<owner>/<coreRepo>.git , or
       • add a remote:  git remote add core <coreRepoUrl>"
    fi
  fi
  info "Fetching core tags from: ${CYAN}${CORE_SRC}${NC}"
  # Namespaced refs so core's v* tags never clobber this repo's own tags.
  git fetch "$CORE_SRC" '+refs/tags/*:refs/core-sync/*' --force
  CORE_REF=$(git for-each-ref --sort=-v:refname --format='%(refname)' 'refs/core-sync/' \
             | grep -E '/v[0-9][^/]*$' | head -n1)
  [ -n "$CORE_REF" ] || err "No release tags (v*) found in core repo ($CORE_SRC)."
  CORE_LABEL="${CORE_REF##*/}"
fi
info "Latest core tag: ${CYAN}${CORE_LABEL}${NC}"
git rev-parse -q --verify "${CORE_REF}^{commit}" >/dev/null 2>&1 \
  || err "Core ref ${CORE_REF} not present locally (fetch failed?)."

# Fast-path: already stamped at this tag → nothing to do.
if [ -f .core-version ] && [ "$(cat .core-version)" = "$CORE_LABEL" ]; then
  ok "Already on $CORE_LABEL (per .core-version) – nothing to do."
  [ "$STASHED" = true ] && warn "Stash present → git stash pop"
  exit 0
fi

# ──────────────────────────────────────────────
# 4. Build KEEP set (plugins to preserve from this repo's HEAD)
# ──────────────────────────────────────────────
current_plugins() { git ls-tree --name-only "HEAD:src/plugins" 2>/dev/null || true; }

KEEP=" "
add_keep() { case "$KEEP" in *" $1 "*) ;; *) KEEP="${KEEP}$1 " ;; esac; }

if [ "$MODE" = "branch" ]; then
  CORE_PLUGIN_SET=" $(git ls-tree --name-only "${CORE_REF}:src/plugins" 2>/dev/null | tr '\n' ' ') "
  add_keep "$PLUGIN_NAME"                        # always keep the dev plugin
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$CORE_PLUGIN_SET" in
      *" $p "*) : ;;                             # in core → let it sync
      *)        add_keep "$p" ;;                 # branch-only → keep
    esac
  done < <(current_plugins)
else
  while IFS= read -r p; do                       # repo mode: keep ALL local plugins
    [ -n "$p" ] || continue
    add_keep "$p"
  done < <(current_plugins)
fi
info "Keeping plugins:${CYAN}${KEEP}${NC}"

# ──────────────────────────────────────────────
# 5. Safety net: any failure before commit fully restores the pre-sync tree.
# ──────────────────────────────────────────────
RESTORE_ON_EXIT=true
cleanup() {
  if [ "${RESTORE_ON_EXIT:-false}" = true ]; then
    warn "Aborting — restoring working tree (git reset --hard HEAD)."
    git reset --hard HEAD >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ──────────────────────────────────────────────
# 6. Reset tracked tree to core (adds + updates + DELETES). Untracked untouched.
# ──────────────────────────────────────────────
info "Resetting tracked tree to ${CORE_LABEL} ..."
git read-tree -u --reset "$CORE_REF"

# repo mode: unless --with-core-plugins, drop core's sibling plugins so the repo
# carries ONLY its own plugin(s) + core scaffolding.
if [ "$MODE" = "repo" ] && [ "$WITH_CORE_PLUGINS" != true ]; then
  info "repo mode: dropping core's sibling plugins (keeping only this repo's)"
  rm -rf src/plugins
fi

# ──────────────────────────────────────────────
# 7. Restore kept plugins (+ optional KEEP_PATHS) from this repo's HEAD.
# ──────────────────────────────────────────────
info "Restoring kept plugins from ${CURRENT_BRANCH}@HEAD ..."
mkdir -p src/plugins
for p in $KEEP; do
  [ -n "$p" ] || continue
  rm -rf "src/plugins/$p"
  if git cat-file -e "HEAD:src/plugins/$p" 2>/dev/null; then
    git checkout HEAD -- "src/plugins/$p"
    echo "  • kept src/plugins/$p"
  else
    warn "Expected plugin not in HEAD (skipped): src/plugins/$p"
  fi
done

if [ -n "${KEEP_PATHS:-}" ]; then
  info "Preserving extra paths from HEAD: $KEEP_PATHS"
  for kp in $KEEP_PATHS; do
    rm -rf "$kp"
    if git cat-file -e "HEAD:$kp" 2>/dev/null; then
      git checkout HEAD -- "$kp"; echo "  • kept $kp"
    else
      warn "KEEP_PATHS entry not in HEAD (skipped): $kp"
    fi
  done
fi

# ──────────────────────────────────────────────
# 8. Re-stamp core version marker.
# ──────────────────────────────────────────────
echo "$CORE_LABEL" > .core-version

# ──────────────────────────────────────────────
# 9. Stage + commit only if something changed.
# ──────────────────────────────────────────────
git add -A
if git diff --cached --quiet; then
  RESTORE_ON_EXIT=false; trap - EXIT
  ok "Already fully synced to $CORE_LABEL (no changes)."
else
  if [ "$MODE" = "branch" ]; then
    git commit -m "chore: sync core to $CORE_LABEL (keep plugin $PLUGIN_NAME)"
  else
    git commit -m "chore: sync core to $CORE_LABEL (repo mode; keep local plugins)"
  fi
  RESTORE_ON_EXIT=false; trap - EXIT
  ok "Committed core sync → $CORE_LABEL"
fi

# ──────────────────────────────────────────────
# 10. Sanity + reminders
# ──────────────────────────────────────────────
for p in $KEEP; do
  [ -n "$p" ] || continue
  [ -d "src/plugins/$p" ] || warn "Kept plugin missing after sync (unexpected): $p"
done

warn "Run:  npm ci   (or npm install)  to refresh dependencies"
if [ "$STASHED" = true ]; then
  echo; warn "Your previous changes are in the stash."; info "Restore with:  git stash pop"
fi
ok "Done. Core synced to $CORE_LABEL; kept:${KEEP}"
