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
NC='\033[0m'

info()    { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()      { echo -e "${GREEN}✅${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
err()     { echo -e "${RED}❌${NC} $1"; }
section() { echo -e "\n${CYAN}── $1 ──${NC}"; }

# ──────────────────────────────────────────────
# Branch model (one script, all branches)
#   main            → pull --rebase (additive)
#   plugin-template → hard-mirror to origin (destructive, workflow-owned)
#   plugin-<name>   → CI-OWNED. sync.sh does NOT rewrite these. It only reports
#                     status and fast-forwards when it can. Merging core into a
#                     plugin branch is now the plugin CI's job, never this script's.
#   new origin/*    → auto-created locally, then synced by its type
#
# Why the change: a previous version merged the latest core tag into plugin-*
# branches with `-X theirs`, which silently discarded plugin edits on any file
# both core and the plugin touched. Combined with CI pushing to the same branch,
# that produced a permanently diverged, content-wiped plugin-error-reporter.
# Plugin branches are now owned by CI end-to-end; sync.sh stays hands-off.
#
# Usage:
#   ./sync.sh                → sync ALL branches, return to start
#   ./sync.sh --stash | -s   → auto-stash local changes first
# ──────────────────────────────────────────────

# ──────────────────────────────────────────────
# 1. Safety checks
# ──────────────────────────────────────────────
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  err "Not inside a git repository."
  exit 1
fi

START_BRANCH=$(git rev-parse --abbrev-ref HEAD)

section "Local status (before sync)"
STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  warn "You have local changes:"
  echo; git status -sb; echo
  if [ "${1:-}" = "--stash" ] || [ "${1:-}" = "-s" ]; then
    info "Stashing local changes..."
    git stash push -u -m "sync-all auto-stash $(date +%Y-%m-%d_%H:%M)"
    STASHED=true
    ok "Stashed."
  else
    err "Working tree is dirty. Commit, or re-run with --stash. Syncing all branches needs a clean tree."
    exit 1
  fi
else
  ok "Working tree is clean."
fi

# ──────────────────────────────────────────────
# 2. Fetch everything
# ──────────────────────────────────────────────
section "Fetching remote"
git fetch --all --tags --prune --prune-tags
ok "Fetch complete."

# Latest CORE tag (v*), highest version — not plugin-*-v* tags.
LATEST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -n1 || true)
[ -n "$LATEST_TAG" ] && info "Latest core tag: ${CYAN}${LATEST_TAG}${NC}"

# ──────────────────────────────────────────────
# 3. Create local branches for any NEW origin/* branches
# ──────────────────────────────────────────────
section "Detecting new remote branches"
NEW_COUNT=0
for remote_branch in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin/ | grep -v 'origin/HEAD'); do
  branch="${remote_branch#origin/}"
  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    git branch --track "$branch" "$remote_branch" >/dev/null 2>&1 && {
      ok "Created local branch tracking $remote_branch"
      NEW_COUNT=$((NEW_COUNT+1))
    }
  fi
done
[ "$NEW_COUNT" -eq 0 ] && info "No new remote branches."

# ──────────────────────────────────────────────
# Guard: a plugin-<name> branch must actually contain that plugin, and must NOT
# carry a plugin-template sync commit. Catches the exact corruption that wiped
# plugin-error-reporter (a "sync plugin-template" commit landing on a plugin
# branch). Returns non-zero if the branch looks wrong.
# ──────────────────────────────────────────────
plugin_branch_is_sane() {
  local branch="$1"
  local plugin="${branch#plugin-}"

  # A plugin-template commit has no business on a real plugin branch.
  if git log --oneline -30 "origin/$branch" 2>/dev/null | grep -qi "sync plugin-template"; then
    err "$branch carries a 'sync plugin-template' commit — wrong content type."
    return 1
  fi

  # The plugin's own folder should exist on the branch.
  if ! git cat-file -e "origin/$branch:src/plugins/${plugin}/manifest.json" 2>/dev/null; then
    warn "$branch has no src/plugins/${plugin}/manifest.json — can't confirm identity."
  fi
  return 0
}

# ──────────────────────────────────────────────
# 4. Sync each local branch by its type
# ──────────────────────────────────────────────
sync_one() {
  local branch="$1"
  section "Syncing: $branch"

  if ! git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
    warn "No origin/$branch – skipping (local-only branch)."
    return
  fi

  git checkout "$branch" >/dev/null 2>&1

  if [ "$branch" = "plugin-template" ]; then
    # Workflow-owned mirror: force local to match origin exactly.
    git reset --hard "origin/$branch"
    ok "plugin-template mirrored to origin."

  elif [[ "$branch" == plugin-* ]]; then
    # CI-OWNED plugin branch. sync.sh no longer rebases or merges core here —
    # that job belongs to plugin CI. We only fast-forward when safe and report.
    if ! plugin_branch_is_sane "$branch"; then
      err "$branch failed identity check — leaving it untouched. Inspect it manually."
      return 1
    fi

    local ahead behind
    ahead=$(git rev-list --count "origin/$branch".."$branch" 2>/dev/null || echo 0)
    behind=$(git rev-list --count "$branch".."origin/$branch" 2>/dev/null || echo 0)

    if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
      ok "$branch already matches origin (CI-owned, nothing to do)."
    elif [ "$ahead" -eq 0 ] && [ "$behind" -gt 0 ]; then
      # Pure fast-forward: take CI's new commits, no rewrite, no merge.
      git merge --ff-only "origin/$branch" \
        && ok "$branch fast-forwarded to origin (${behind} CI commits)." \
        || { err "$branch could not fast-forward. Inspect manually."; return 1; }
    else
      # Diverged: DO NOT auto-resolve. This is the state that caused the wipe.
      err "$branch has DIVERGED (${ahead} ahead, ${behind} behind). sync.sh will not touch it."
      err "  CI owns this branch. If your local is junk:  git reset --hard origin/$branch"
      err "  If you have real local work:  inspect with  git log origin/$branch..$branch"
      return 1
    fi

  else
    # main / any human branch: plain additive pull.
    if git pull origin "$branch" --rebase --autostash; then
      ok "$branch up to date with origin."
    else
      err "Pull failed on $branch. Resolve conflicts, then re-run."
      return 1
    fi
  fi
}

FAILED=()
for branch in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  sync_one "$branch" || FAILED+=("$branch")
done

# ──────────────────────────────────────────────
# 5. Return to starting branch + overview
# ──────────────────────────────────────────────
git checkout "$START_BRANCH" >/dev/null 2>&1 || true

section "Branch overview"
for branch in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  remote_ref="origin/$branch"
  if git rev-parse --verify "$remote_ref" >/dev/null 2>&1; then
    ahead=$(git rev-list --count "$remote_ref".."$branch" 2>/dev/null || echo 0)
    behind=$(git rev-list --count "$branch".."$remote_ref" 2>/dev/null || echo 0)
    if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
      echo -e "  ${GREEN}●${NC} $branch  (up to date)"
    elif [ "$ahead" -gt 0 ] && [ "$behind" -eq 0 ]; then
      echo -e "  ${YELLOW}↑${NC} $branch  (${ahead} ahead — push when ready)"
    elif [ "$ahead" -eq 0 ] && [ "$behind" -gt 0 ]; then
      echo -e "  ${YELLOW}↓${NC} $branch  (${behind} behind)"
    else
      echo -e "  ${RED}↕${NC} $branch  (${ahead} ahead, ${behind} behind)"
    fi
  else
    echo -e "  ${BLUE}○${NC} $branch  (no remote tracking)"
  fi
done

# ──────────────────────────────────────────────
# 6. Final report
# ──────────────────────────────────────────────
section "Final status"
echo -e "Back on: ${CYAN}${START_BRANCH}${NC}"

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo
  err "These branches did NOT sync cleanly (fix manually):"
  for b in "${FAILED[@]}"; do echo "   - $b"; done
fi

if [ "$STASHED" = true ]; then
  echo
  warn "Your previous changes are stashed. Restore with:  git stash pop"
fi

echo
ok "Sync-all finished."