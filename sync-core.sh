#!/bin/bash
# sync-core.sh - Safely updates core files and sibling plugins for local typechecking

# 1. Identify the current plugin based on branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ ! "$CURRENT_BRANCH" == plugin-* ]]; then
  echo "❌ Error: You must be on a 'plugin-*' branch to run this script."
  exit 1
fi

PLUGIN_NAME=${CURRENT_BRANCH#plugin-}
PLUGIN_DIR="src/plugins/$PLUGIN_NAME"

echo "🔄 Fetching the latest core engine tags..."
git fetch origin --tags --prune

# 2. Get the latest 'v*' tag
LATEST_TAG=$(git describe --tags --match="v*" --abbrev=0 $(git rev-list --tags --max-count=1))

if [ -z "$LATEST_TAG" ]; then
  echo "❌ Error: No release tags found on remote."
  exit 1
fi

echo "📦 Syncing core engine with tag: $LATEST_TAG"

# 3. The Merge
# We merge the tag, bringing in updated core files and core plugins.
# -X theirs ensures that if there are conflicts in core files, the official release wins.
if git merge $LATEST_TAG --no-edit -X theirs -m "chore: sync core engine and plugins with $LATEST_TAG"; then
    
    # 4. Handle the .core-version index
    if [ -f .core-version ] && [ "$(cat .core-version)" == "$LATEST_TAG" ]; then
        echo "✅ Core is already at $LATEST_TAG."
    else
        echo "$LATEST_TAG" > .core-version
        git add .core-version
        
        # Amend the merge commit to include the updated index
        git commit --amend --no-edit
        
        echo "✅ Sync complete! Core and sibling plugins updated to $LATEST_TAG."
        echo "⚠️  Remember to run 'npm ci' to update any core dependencies."
    fi
else
    echo "❌ Merge conflict detected! Please resolve manually."
fi