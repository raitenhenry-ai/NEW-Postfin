#!/usr/bin/env bash
# Auto-commit and push repo changes to GitHub.
set -euo pipefail

cat >/dev/null

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$root" ]]; then
  exit 0
fi
cd "$root"

lockdir="$root/.git/auto-push.lockdir"
if ! mkdir "$lockdir" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$lockdir" 2>/dev/null || true' EXIT

safe_add() {
  git add -A
  git reset -q HEAD -- \
    .env \
    .env.* \
    "*.pem" \
    "*.key" \
    credentials.json \
    2>/dev/null || true
}

has_work() {
  ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]
}

if has_work; then
  safe_add
  if ! git diff --cached --quiet; then
    msg="Auto-sync: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
    git commit -m "$msg" >/dev/null
  fi
fi

if git rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then
  ahead="$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"
  if [[ "$ahead" != "0" ]]; then
    git push origin HEAD >/dev/null 2>&1 || git push -u origin HEAD >/dev/null 2>&1 || true
  fi
else
  git push -u origin HEAD >/dev/null 2>&1 || true
fi

exit 0
