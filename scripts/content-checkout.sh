#!/usr/bin/env bash
# Checks a live Book out into `content.local/<book>/` — a git-ignored tree
# (the `*.local` rule) that sits inside the repo so the content and the code
# are readable side by side, and re-runs safely to pick up whatever the
# backend has published since.
#
#   scripts/content-checkout.sh softwarearchitektur
#
# `content.local/` is its own git repo, which is the whole sync mechanism:
# every run commits the freshly pulled documents, so `git -C content.local
# show HEAD` is exactly what moved upstream since last time, and local edits
# are stashed across the re-pull and replayed onto it. A conflict there is a
# real one — the same lines changed in the app and here — and git keeps the
# stash entry until it's resolved.
#
# Why a wipe-and-pull rather than a diff: `pull-book.ts` requires an empty
# target (it deletes the entity directories it writes) and
# `republish-content.ts` pushes EVERY Book under its tree, so one Book per
# checkout directory is not a convention, it's the contract.
#
# Editing the same Book in-app while it is checked out here still loses one
# side's work — republish leaves the in-app draft alone, so a later in-app
# publish reverts this tree (plan 0023 §8).
#
# Validate, then publish (deliberately not folded in — publishing is a
# separate, outward-facing act):
#
#   BB_CONTENT_DIR=content.local/<book> \
#     corepack pnpm exec vitest run packages/schema/src/content.test.ts
#   BB_CONTENT_DIR=content.local/<book> SUPABASE_URL=... \
#     SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts
set -euo pipefail

book=${1:?usage: scripts/content-checkout.sh <book-id>}
root=$(cd "$(dirname "$0")/.." && pwd)
tree=$root/content.local

mkdir -p "$tree"
# `rev-parse --git-dir` would walk up and find the OUTER repo, so ask for
# this directory's own `.git` instead.
[ -d "$tree/.git" ] || git -C "$tree" init -q
# `git stash` needs a HEAD to diff against, so a fresh tree gets an empty
# root commit rather than failing on its own first run.
git -C "$tree" rev-parse HEAD >/dev/null 2>&1 ||
  git -C "$tree" commit -q --allow-empty -m "empty tree"

stashed=
if [ -n "$(git -C "$tree" status --porcelain -- "$book")" ]; then
  git -C "$tree" stash push -u -q -- "$book"
  stashed=1
  echo "stashed local edits to $book"
fi

rm -rf "${tree:?}/$book"
BB_CONTENT_DIR=$tree/$book node "$root/scripts/pull-book.ts" "$book"

git -C "$tree" add -A -- "$book"
git -C "$tree" commit -q --allow-empty -m "pull $book $(date -I)"
echo "--- upstream changes since the last checkout:"
git -C "$tree" show --stat --oneline HEAD | tail -n +2

if [ -n "$stashed" ]; then
  git -C "$tree" stash pop || {
    echo "your edits conflict with what was published upstream — resolve in $tree/$book; the stash entry is kept"
    exit 1
  }
fi
