#!/bin/bash
set -euo pipefail

# ──────────────────────────────────────────────
# Colors
# ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()      { echo -e "${GREEN}✅${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
err()     { echo -e "${RED}❌${NC} $1"; }
section() { echo -e "\n${CYAN}── $1 ──${NC}"; }

# ──────────────────────────────────────────────
# Branch model
#   main            → human-owned.    Update: pull --rebase (additive).
#   plugin-template → workflow-owned. Update: hard-mirror to origin (destructive).
#   plugin-<name>   → human + CI.     Update: merge core tag with -X theirs (additive).
#
# Usage:
#   ./sync.sh                → update current branch per its type
#   ./sync.sh --stash | -s   → auto-stash local changes first
#   ./sync.sh --mirror-only  → only re-mirror plugin-template, then exit
# ──────────────────────────────────────────────

# ──────────────────────────────────────────────
# 1. Safety checks
# ──────────────────────────────────────────────
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  err "Not inside a git repository."
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
ORIGINAL_BRANCH=$CURRENT_BRANCH

section "Local status (before sync)"

if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  warn "You have local changes:"
  echo
  git status -sb
  echo
  STASHED=false
  if [ "${1:-}" = "--stash" ] || [ "${1:-}" = "-s" ]; then
    info "Stashing local changes..."
    git stash push -u -m "sync-all auto-stash $(date +%Y-%m-%d_%H:%M)"
    STASHED=true
    ok "Stashed."
  else
    warn "Continuing with dirty working tree (use --stash to auto-stash)."
  fi
else
  ok "Working tree is clean."
  STASHED=false
fi

# ──────────────────────────────────────────────
# 2. Fetch everything
# ──────────────────────────────────────────────
section "Fetching remote"
git fetch --all --tags --prune --prune-tags
ok "Fetch complete."

# ──────────────────────────────────────────────
# 3. Re-mirror plugin-template (fixes the recurring divergence)
# ──────────────────────────────────────────────
mirror_plugin_template() {
  if ! git rev-parse --verify "origin/plugin-template" >/dev/null 2>&1; then
    warn "No origin/plugin-template to mirror – skipping."
    return
  fi

  if [ "$CURRENT_BRANCH" = "plugin-template" ]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
      warn "plugin-template has local changes; not mirroring (stash or discard first)."
      return
    fi
    git reset --hard origin/plugin-template
  else
    git branch -f plugin-template origin/plugin-template
  fi
  ok "plugin-template mirrored to origin/plugin-template."
}

section "Mirroring plugin-template"
mirror_plugin_template

if [ "${1:-}" = "--mirror-only" ]; then
  section "Final status"
  git status -sb
  ok "Mirror-only run finished."
  exit 0
fi

# ──────────────────────────────────────────────
# 4. Branch overview
# ──────────────────────────────────────────────
section "Branch overview"

echo -e "Current branch: ${CYAN}${CURRENT_BRANCH}${NC}"
echo

for branch in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  remote_ref="origin/$branch"
  if git rev-parse --verify "$remote_ref" >/dev/null 2>&1; then
    ahead=$(git rev-list --count "$remote_ref".."$branch" 2>/dev/null || echo 0)
    behind=$(git rev-list --count "$branch".."$remote_ref" 2>/dev/null || echo 0)

    if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
      echo -e "  ${GREEN}●${NC} $branch  (up to date)"
    elif [ "$ahead" -gt 0 ] && [ "$behind" -eq 0 ]; then
      echo -e "  ${YELLOW}↑${NC} $branch  (${ahead} ahead)"
    elif [ "$ahead" -eq 0 ] && [ "$behind" -gt 0 ]; then
      echo -e "  ${YELLOW}↓${NC} $branch  (${behind} behind)"
    else
      echo -e "  ${RED}↕${NC} $branch  (${ahead} ahead, ${behind} behind)"
    fi
  else
    echo -e "  ${BLUE}○${NC} $branch  (no remote tracking)"
  fi
done

LATEST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -n1 || true)
if [ -n "$LATEST_TAG" ]; then
  echo
  info "Latest core tag: ${CYAN}${LATEST_TAG}${NC}"
  if [ -f .core-version ]; then
    CORE_VER=$(cat .core-version)
    if [ "$CORE_VER" = "$LATEST_TAG" ]; then
      ok "This branch .core-version is already at $LATEST_TAG"
    else
      warn "This branch .core-version is at $CORE_VER (latest is $LATEST_TAG)"
    fi
  fi
fi

# ──────────────────────────────────────────────
# 5. Update the CURRENT branch, per its type
# ──────────────────────────────────────────────
section "Updating current branch: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" = "plugin-template" ]; then
  ok "plugin-template is a mirror; already realigned to origin (no pull/merge)."

elif [[ "$CURRENT_BRANCH" == plugin-* ]]; then
  if git rev-parse --verify "origin/$CURRENT_BRANCH" >/dev/null 2>&1; then
    if git pull origin "$CURRENT_BRANCH" --rebase --autostash; then
      ok "Pulled latest $CURRENT_BRANCH from origin."
    else
      err "Pull/rebase failed on $CURRENT_BRANCH. Resolve conflicts then re-run."
      exit 1
    fi
  else
    warn "No remote branch origin/$CURRENT_BRANCH – skipping pull."
  fi

  section "Plugin core sync"
  if [ -z "$LATEST_TAG" ]; then
    err "No core release tags (v*) found – cannot sync core."
  elif [ -f .core-version ] && [ "$(cat .core-version)" = "$LATEST_TAG" ]; then
    ok "Already on core $LATEST_TAG – nothing to merge."
  else
    info "Merging core tag $LATEST_TAG into $CURRENT_BRANCH ..."
    # NOTE: -X theirs = core wins every conflicting hunk. Right for engine files,
    # but it overwrites YOUR edits on any file both core and your plugin changed.
    if git merge "$LATEST_TAG" --no-edit -X theirs -m "chore: sync core engine with $LATEST_TAG"; then
      echo "$LATEST_TAG" > .core-version
      git add .core-version
      git commit --amend --no-edit 2>/dev/null || \
        git commit -m "chore: update .core-version to $LATEST_TAG" || true
      ok "Core synced to $LATEST_TAG"
      warn "Run 'npm ci' (or 'npm install') to refresh dependencies."
      info "Push with: git push origin $CURRENT_BRANCH"
    else
      err "Merge conflict while syncing core. Fix manually, then commit."
      exit 1
    fi
  fi

else
  if git rev-parse --verify "origin/$CURRENT_BRANCH" >/dev/null 2>&1; then
    if git pull origin "$CURRENT_BRANCH" --rebase --autostash; then
      ok "Branch $CURRENT_BRANCH is up to date with origin."
    else
      err "Pull/rebase failed on $CURRENT_BRANCH. Resolve conflicts then re-run."
      exit 1
    fi
  else
    warn "No remote branch origin/$CURRENT_BRANCH – skipping pull."
  fi
fi

# ──────────────────────────────────────────────
# 6. Final report
# ──────────────────────────────────────────────
section "Final status"

git status -sb
echo

if [ "$STASHED" = true ]; then
  warn "Your previous changes are in the stash."
  info "Restore them with:  git stash pop"
fi

ok "Sync finished."
