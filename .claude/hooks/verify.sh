#!/usr/bin/env bash
# Stop hook: before Claude finishes a turn, run lint + typecheck on what changed.
# If it fails, exit 2 so Claude reads the error and keeps working.
# It only checks lint and typecheck (fast); the full tests run in /story step 4 and in CI.

input="$(cat)"

# Avoid infinite loops: if Claude is already continuing because of this hook, let it stop.
if echo "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Nothing changed in the working tree -> nothing to verify.
if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  exit 0
fi

output="$(pnpm nx affected -t lint typecheck --base=HEAD 2>&1)"
status=$?

if [ $status -ne 0 ]; then
  echo "lint/typecheck failed on the changed projects. Fix the errors below before finishing:" >&2
  echo "$output" | tail -n 60 >&2
  exit 2
fi

exit 0
