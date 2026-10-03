#!/bin/sh
# Heavy test runs, one at a time on this computer.
#
# Several checkouts (Strom, strom-beta) and Strom Research run their suites on
# the same machine. Run together they overload it (load 60-160) and tests time
# out at random. Every heavy run takes a shared lock first and waits for the
# one already running.
#
#   scripts/e2e.sh [playwright args]   build, then the browser suite (all args go to Playwright)
#   scripts/e2e.sh --quick [specs]     before a beta push: typecheck, vitest, build, the @smoke
#                                      set and the specs touched since github/beta (plus [specs])
#   scripts/e2e.sh --run <command...>  any command under the lock, in the caller's folder
#                                      (e.g. Strom Research's suite)
#
# The lock is a directory (mkdir is atomic): $STROM_TEST_LOCK, default
# /tmp/strom-heavy-tests.lock, holding who has it. A lock whose process is
# gone is taken over. Nested calls (STROM_TEST_LOCK_HELD=1) do not wait.
set -eu

LOCK="${STROM_TEST_LOCK:-/tmp/strom-heavy-tests.lock}"
# The app's own runs work in this checkout; --run stays where it was called.
[ "${1:-}" = --run ] || cd "$(dirname "$0")/.."

acquire() {
    [ "${STROM_TEST_LOCK_HELD:-}" = 1 ] && return 0
    said=""
    while ! mkdir "$LOCK" 2>/dev/null; do
        pid=$(sed -n 's/^pid=//p' "$LOCK/owner" 2>/dev/null || true)
        if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
            echo "e2e.sh: the lock of a finished run ($pid) is taken over"
            rm -rf "$LOCK"
            continue
        fi
        if [ -z "$said" ]; then
            echo "e2e.sh: waiting for another heavy test run:"
            sed 's/^/    /' "$LOCK/owner" 2>/dev/null || true
            said=1
        fi
        sleep 5
    done
    printf 'pid=%s\nwhere=%s\nwhat=%s\nsince=%s\n' "$$" "$(pwd)" "$*" "$(date '+%Y-%m-%d %H:%M:%S')" > "$LOCK/owner"
    trap release EXIT
    trap 'exit 130' INT TERM
    STROM_TEST_LOCK_HELD=1
    export STROM_TEST_LOCK_HELD
}

release() {
    if [ "$(sed -n 's/^pid=//p' "$LOCK/owner" 2>/dev/null || true)" = "$$" ]; then rm -rf "$LOCK"; fi
}

# Specs touched since the last push (committed or not, new ones too), and the
# specs using a touched e2e helper.
touched_specs() {
    base=$(git rev-parse --verify -q github/beta 2>/dev/null || git rev-parse HEAD)
    changed=$( { git diff --name-only "$base" -- e2e; git ls-files --others --exclude-standard -- e2e; } | sort -u)
    for f in $changed; do
        [ -f "$f" ] || continue
        case "$f" in
            *.spec.ts) echo "$f" ;;
            e2e/*.ts) helper=$(basename "$f" .ts); grep -l "from './$helper.js'" e2e/*.spec.ts 2>/dev/null || true ;;
        esac
    done | sort -u
}

case "${1:-}" in
    --run)
        shift
        acquire "$*"
        "$@"
        ;;
    --quick)
        shift
        acquire "quick suite"
        start=$(date +%s)
        npm run typecheck
        npx vitest run
        npm run build
        npx playwright test --grep @smoke
        specs=$( { touched_specs; for s in "$@"; do echo "$s"; done; } | sort -u)
        if [ -n "$specs" ]; then
            echo "e2e.sh: touched specs:" $specs
            # shellcheck disable=SC2086
            npx playwright test $specs
        fi
        echo "e2e.sh: quick suite passed in $(( $(date +%s) - start )) s"
        ;;
    *)
        acquire "e2e $*"
        npm run build
        npx playwright test "$@"
        ;;
esac
