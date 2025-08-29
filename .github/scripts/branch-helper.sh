#!/bin/bash

# Branch Target Helper for homebridge-smarthq
# This script helps determine which beta branch to target based on change type

echo "🏠 Homebridge SmartHQ - Branch Target Helper"
echo "==========================================="
echo

# Ensure we have the latest remote info
git fetch origin >/dev/null 2>&1

# Get current versions
STABLE_VERSION=$(git show latest:package.json 2>/dev/null | grep '"version"' | cut -d'"' -f4)
BETA_BRANCHES=$(git branch -r | grep "origin/beta-" | sed 's/.*origin\///' | sort -V)

echo "📊 Current State:"
echo "  Stable version (latest): $STABLE_VERSION"
echo "  Available beta branches:"
if [ -z "$BETA_BRANCHES" ]; then
    echo "    - beta-0.5.0 (active development - v0.5.0-beta.4)"
else
    for branch in $BETA_BRANCHES; do
        echo "    - $branch"
    done
fi
echo

echo "🎯 Branch Targeting Guide:"
echo "  🐛 Bug fixes (patch):     beta-0.4.1 (patches) or beta-0.5.0 (development)"
echo "  ✨ New features (minor):  beta-0.5.0 (active development)"
echo "  💥 Breaking changes:      beta-1.0.0 (create if needed)"
echo

echo "📋 Required Labels:"
echo "  - patch: Bug fixes, security patches, documentation"
echo "  - minor: New features, enhancements" 
echo "  - major: Breaking changes, API changes"
echo

echo "⚠️  Remember: ALL PRs must target beta branches, never 'latest' directly!"