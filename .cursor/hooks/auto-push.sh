#!/usr/bin/env bash
# Auto-commit and push every local change to GitHub.
set +e

# Drain hook stdin JSON
cat >/dev/null 2>&1 || true

root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$root" ]]; then
  exit 0
fi
cd "$root" || exit 0

# Stale lock cleanup (older than 2 minutes) + acquire lock
lockdir="$root/.git/auto-push.lockdir"
if [[ -d "$lockdir" ]]; then
  # macOS stat format
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

# Stage everything except common secrets
git add -A 2>/dev/null
git reset -q HEAD -- .env 2>/dev/null
git reset -q HEAD -- .env.local 2>/dev/null
git reset -q HEAD -- .env.production 2>/dev/null
git reset -q HEAD -- "*.pem" 2>/dev/null
git reset -q HEAD -- "*.key" 2>/dev/null
git reset -q HEAD -- credentials.json 2>/dev/null

if ! git diff --cached --quiet 2>/dev/null; then
  msg="Auto-sync: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
  git -c user.email="$(git config user.email 2>/dev/null || echo auto@local)" \
      -c user.name="$(git config user.name 2>/dev/null || echo Auto-Sync)" \
      commit -m "$msg" >/dev/null 2>&1
fi

# Always try to push if we have commits not on remote
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  if [[ "${ahead:-0}" != "0" ]]; then
    git push origin HEAD >/dev/null 2>&1 || git push -u origin HEAD >/dev/null 2>&1
  fi
else
  git push -u origin HEAD >/dev/null 2>&1
fi

exit 0
