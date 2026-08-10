#!/bin/bash

echo "🔄 Syncing local repository with GitHub..."

# 1. Fetch all changes and tags, and prune deleted remote data
git fetch --all --tags --prune --prune-tags

# 2. Get the name of your current branch (e.g., 'main')
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 3. Pull the latest commits using rebase and autostash
# (Autostash temporarily hides your uncommitted changes, pulls the bot's 
# remote commits, and then pops your uncommitted changes back on top).
echo "📥 Pulling latest commits for branch: $CURRENT_BRANCH..."
git pull origin $CURRENT_BRANCH --rebase --autostash

echo "✅ Sync complete! Your local repo is up to date."