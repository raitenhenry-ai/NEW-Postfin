#!/usr/bin/env bash
# Pull latest from GitHub when you open the project / start a session.
set +e

cat >/dev/null 2>&1 || true

root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$root" ]]; then
  exit 0
fi
cd "$root" || exit 0

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
remote="origin"

git fetch "$remote" 2>/dev/null
if git rev-parse --verify "$remote/$branch" >/dev/null 2>&1; then
  git pull --rebase --autostash "$remote" "$branch" >/dev/null 2>&1 || {
    git rebase --abort >/dev/null 2>&1
  }
fi

exit 0
