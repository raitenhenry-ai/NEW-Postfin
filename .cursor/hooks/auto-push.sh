#!/usr/bin/env bash
# Pull partner changes first, then commit + push local work.
# Never force-pushes. Aborts push if pull/rebase has conflicts.
set +e

cat >/dev/null 2>&1 || true

root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$root" ]]; then
  exit 0
fi
cd "$root" || exit 0

lockdir="$root/.git/auto-push.lockdir"
if [[ -d "$lockdir" ]]; then
  lock_age=$(( $(date +%s) - $(stat -f %m "$lockdir" 2>/dev/null || echo 0) ))
  if (( lock_age > 120 )); then
    rmdir "$lockdir" 2>/dev/null || rm -rf "$lockdir" 2>/dev/null
  fi
fi
if ! mkdir "$lockdir" 2>/dev/null; then
  exit 0
fi
cleanup() { rmdir "$lockdir" 2>/dev/null || rm -rf "$lockdir" 2>/dev/null; }
trap cleanup EXIT

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
remote="origin"

# 1) Always fetch + pull partner edits before we touch anything
#    --autostash keeps your local uncommitted work safe during pull
git fetch "$remote" 2>/dev/null
if git rev-parse --verify "$remote/$branch" >/dev/null 2>&1; then
  if ! git pull --rebase --autostash "$remote" "$branch" >/dev/null 2>&1; then
    # Conflict or pull failure — stop so we never overwrite partner work
    git rebase --abort >/dev/null 2>&1
    git merge --abort >/dev/null 2>&1
    exit 0
  fi
fi

# 2) Stage local changes (skip secrets)
git add -A 2>/dev/null
git reset -q HEAD -- .env 2>/dev/null
git reset -q HEAD -- .env.local 2>/dev/null
git reset -q HEAD -- .env.production 2>/dev/null
git reset -q HEAD -- "*.pem" 2>/dev/null
git reset -q HEAD -- "*.key" 2>/dev/null
git reset -q HEAD -- credentials.json 2>/dev/null

# 3) Commit if there is anything new locally
if ! git diff --cached --quiet 2>/dev/null; then
  msg="Auto-sync: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
  git commit -m "$msg" >/dev/null 2>&1
fi

# 4) Pull once more (in case partner pushed while we committed), then push
if git rev-parse --verify "$remote/$branch" >/dev/null 2>&1; then
  if ! git pull --rebase --autostash "$remote" "$branch" >/dev/null 2>&1; then
    git rebase --abort >/dev/null 2>&1
    exit 0
  fi
fi

# Regular push only — never --force
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  if [[ "${ahead:-0}" != "0" ]]; then
    git push "$remote" HEAD >/dev/null 2>&1 || git push -u "$remote" HEAD >/dev/null 2>&1
  fi
else
  git push -u "$remote" HEAD >/dev/null 2>&1
fi

exit 0
