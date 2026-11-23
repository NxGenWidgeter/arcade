#!/usr/bin/env bash
# Publish the static edition to the gh-pages branch.
#
# GitHub Pages serves that branch at https://nxgenwidgeter.github.io/arcade/.
# There is no build step: the site is index.html + arcade.js + icon.svg — the
# same three files the desktop window serves. Each publish is a single squashed
# commit, so the branch history stays one entry per release instead of one per
# file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-gh-pages}"
SITE=(index.html arcade.js icon.svg glasswarm.css)

# A publish with stale bytes is worse than no publish: prove the payload.
for f in "${SITE[@]}"; do
  [ -s "$f" ] || { echo "refusing to publish: $f missing or empty" >&2; exit 1; }
done
grep -q 'arcade.js' index.html \
  || { echo "refusing to publish: index.html does not load arcade.js" >&2; exit 1; }
grep -q 'glasswarm.css' index.html \
  || { echo "refusing to publish: index.html does not load glasswarm.css" >&2; exit 1; }
# the bundled copy must be the installed theme, not last month's
if [ -f "$HOME/.local/share/nxg-themes/glasswarm/glasswarm.css" ]; then
  cmp -s glasswarm.css "$HOME/.local/share/nxg-themes/glasswarm/glasswarm.css" \
    || { echo "refusing to publish: glasswarm.css != installed theme (run glasswarm/sync-static.sh)" >&2; exit 1; }
fi
node --check arcade.js \
  || { echo "refusing to publish: arcade.js does not parse" >&2; exit 1; }

REMOTE_URL="$(git -C "$ROOT" remote get-url "$REMOTE")"
NAME="$(git -C "$ROOT" config user.name || true)"
EMAIL="$(git -C "$ROOT" config user.email || true)"
NAME="${NAME:-NxGenWidgeter}"
EMAIL="${EMAIL:-nxautomation003@gmail.com}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -a "${SITE[@]}" "$TMP"/
: > "$TMP/.nojekyll"                    # serve the files as-is, no Jekyll pass

cd "$TMP"
git init -q -b "$BRANCH"
git config user.name "$NAME"
git config user.email "$EMAIL"
git add -A
git commit -q -m "Site: arcade $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q --force "$REMOTE_URL" "$BRANCH"

echo "published ${SITE[*]} to $BRANCH -> https://nxgenwidgeter.github.io/arcade/"
