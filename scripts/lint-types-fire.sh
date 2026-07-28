#!/usr/bin/env bash
# Type-aware eslint rules fail OPEN: without a working project service they
# report nothing at all and `pnpm lint` goes green on code they should catch.
# That is indistinguishable from clean code, so assert the wiring directly —
# plant a floating promise and require the rule to name it.
#
# (`eslint-plugin-import-x`'s no-cycle failed exactly this way and silently
# passed every synthetic cycle, which is why this check exists.)
set -uo pipefail

probe="apps/web/src/__lint_types_fire_probe.ts"
cleanup() { rm -f "$probe"; }
trap cleanup EXIT

cat > "$probe" <<'EOF'
async function work(): Promise<void> {}
export function probe(): void {
  work();
}
EOF

if corepack pnpm exec eslint "$probe" 2>&1 | grep -q "no-floating-promises"; then
  echo "ok: type-aware rules are live"
else
  echo "FAIL: type-aware eslint rules are not firing — the project service is"
  echo "      misconfigured and 'pnpm lint' is passing everything silently."
  exit 1
fi
