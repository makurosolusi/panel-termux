#!/bin/sh
# Shell test of the compiled binary's CLI (PLAN/07 §9.2) in fake mode: temp HOME/PREFIX/cwd, stdin not a TTY.
# Run: bun run build:local && sh scripts/cli.test.sh dist/panel. POSIX sh (dash on Ubuntu, sh on macOS).
set -eu

[ $# -eq 1 ] || { echo "usage: sh scripts/cli.test.sh <panel binary>" >&2; exit 2; }
BIN=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
[ -x "$BIN" ] || { echo "not executable: $BIN" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
VERSION=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$REPO/package.json")
# The binary is a bun runtime too (BUN_BE_BUN=1): JSON parsing and the stub health server need no other tool.
BUNX() { BUN_BE_BUN=1 "$BIN" "$@"; }

T=$(mktemp -d)
SRV=
# stop_srv: kill the stub health server (a PID this script started) and reap it; idempotent.
stop_srv() {
  [ -n "$SRV" ] || return 0
  kill "$SRV" 2>/dev/null || true
  wait "$SRV" 2>/dev/null || true
  SRV=
}
cleanup() { stop_srv; rm -rf "$T"; }
trap cleanup EXIT
trap 'cleanup; trap - EXIT; exit 130' INT
trap 'cleanup; trap - EXIT; exit 143' TERM
# $T/box is the sandbox the panel sees (HOME, PREFIX, cwd); test outputs live in $T/o, outside it.
BOX="$T/box"
O="$T/o"
mkdir -p "$BOX/home" "$BOX/usr" "$BOX/cwd" "$O/tmp"
export HOME="$BOX/home" PREFIX="$BOX/usr" TMPDIR="$O/tmp"
unset TERMUX_VERSION PANEL_CLI_FAKE PANEL_CLI_FAKE_RECORD BUN_OPTIONS BUN_BE_BUN 2>/dev/null || true
cd "$BOX/cwd"

fail() { echo "FAIL: $*" >&2; exit 1; }
# run <expected exit code> <args...>: stdout → $O/out, stderr → $O/err. $FAKE/$REC (set only by fake) become
# PANEL_CLI_FAKE/PANEL_CLI_FAKE_RECORD; a `VAR=x run` prefix would leak past the call in some shells.
FAKE=
REC=
run() {
  want=$1
  shift
  rc=0
  env ${FAKE:+PANEL_CLI_FAKE=$FAKE} ${REC:+PANEL_CLI_FAKE_RECORD=$REC} "$BIN" "$@" </dev/null >"$O/out" 2>"$O/err" || rc=$?
  [ "$rc" -eq "$want" ] || { cat "$O/out" "$O/err"; fail "panel $* exited $rc, want $want"; }
}
# fake <scenario> <expected exit code> <args...>
fake() {
  FAKE=$1
  shift
  run "$@"
  FAKE=
}
has() { grep -qF -- "$2" "$O/$1" || { cat "$O/$1"; fail "$1 lacks: $2"; }; }
lacks() { if grep -qF -- "$2" "$O/$1"; then fail "$1 contains: $2"; fi; }
listing() { find "$BOX" | sort; }

# --- help and version ---
listing >"$O/before"
for f in -h --help --h help; do
  run 0 "$f"
  has out "Pemakaian"
  has out "panel serve"
done
for f in -v --version --v; do
  run 0 "$f"
  grep -qE "^panel-termux $VERSION \([a-z0-9]+-[a-z0-9]+, bun [0-9]+\.[0-9]+\.[0-9]+\)\$" "$O/out" ||
    fail "panel $f printed '$(cat "$O/out")', want 'panel-termux $VERSION (<platform>-<arch>, bun <x.y.z>)'"
  [ "$(wc -l <"$O/out")" -eq 1 ] || fail "panel $f printed more than one line"
done
run 2 -v --json

# --- unknown arguments: exit 2 fast, nothing booted ---
start=$(date +%s)
run 2 --bogus
run 2 bogus
run 2 docs google extra
[ $(($(date +%s) - start)) -le 2 ] || fail "unknown arguments took more than 2 s"
run 2 upgrade
has err "baris pasang"
# init (0.5.1, W0 stub steps): fake dry run prints the plan and exits 0; W2 extends this per scenario
fake fresh 0 init --dry-run
has out "HP ini belum punya instalasi panel"

# --- env: the 4 required keys, empty values, nothing on stderr without .env ---
run 0 env
cp "$O/out" "$O/env"
[ ! -s "$O/err" ] || { cat "$O/err"; fail "env wrote to stderr without a .env"; }
# dotenv: every non-comment, non-blank line is KEY= with an empty value
grep -v '^#' "$O/env" | grep -v '^$' >"$O/env.lines" || true
grep -vqE '^[A-Z_][A-Z0-9_]*=$' "$O/env.lines" && fail "env has a line that is not KEY= : $(grep -vE '^[A-Z_][A-Z0-9_]*=$' "$O/env.lines")"
keys=$(sed 's/=$//' "$O/env.lines" | tr '\n' ' ')
[ "$keys" = "APP_BASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SUPER_ADMIN_EMAILS " ] || fail "env keys: '$keys'"
"$BIN" env </dev/null >"$O/env.redirected"
cmp -s "$O/env" "$O/env.redirected" || fail "env > f differs from env stdout"
run 0 --env
cmp -s "$O/env" "$O/out" || fail "--env differs from env"
run 0 env --full
cmp -s "$O/out" "$REPO/.env.example" || fail "env --full differs from .env.example"

# --- docs: topic list, each topic, unknown topic ---
run 0 docs
for topic in google cloudflare android paket; do has out "$topic"; done
for topic in google cloudflare android paket; do
  run 0 docs "$topic"
  [ -s "$O/out" ] || fail "docs $topic is empty"
done
run 2 docs instal

# --- doctor (fake host) ---
run 1 doctor
has err "bukan Termux"
fake fresh 1 doctor
fake ready 0 doctor
fake ready 0 doctor --json
BUNX -e 'const j = JSON.parse(await Bun.stdin.text()); process.exit(j.schema === 1 && j.ok === true ? 0 : 1)' <"$O/out" ||
  fail "doctor --json stdout is not a schema-1 report: $(head -c 200 "$O/out")"
fake fresh 1 doctor --json
BUNX -e 'const j = JSON.parse(await Bun.stdin.text()); process.exit(j.schema === 1 && j.ok === false ? 0 : 1)' <"$O/out" ||
  fail "fresh doctor --json is not a failing schema-1 report"
fake bogus 2 doctor

# --- rollback without panel.prev ---
fake ready 1 rollback --yes

# -v/-h/env/docs/doctor created nothing in HOME, PREFIX or cwd
listing >"$O/after"
cmp -s "$O/before" "$O/after" || { diff "$O/before" "$O/after" || true; fail "CLI commands created files"; }

# --- D3: .env secrets never reach recorded child env, stdout or stderr ---
SENTINEL=sentinel-7c1f0e
printf 'APP_BASE_URL=https://panel.contoh.test\nGOOGLE_CLIENT_ID=x.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=%s\nSUPER_ADMIN_EMAILS=a@contoh.test\n' "$SENTINEL" >.env
cp .env "$O/env.orig"
REC="$O/rec"
fake ready 0 doctor
REC=
[ -s "$O/rec" ] || fail "PANEL_CLI_FAKE_RECORD recorded nothing"
for k in APP_BASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SUPER_ADMIN_EMAILS PORT PANEL_DATA_DIR; do
  if grep -qF "\"$k\"" "$O/rec"; then fail "child env got $k"; fi
done
for f in rec out err; do lacks "$f" "$SENTINEL"; done
run 0 --version
lacks out "https://panel.contoh.test"

# --- env next to an existing .env ---
run 0 env
has err "sudah ada"
lacks out "$SENTINEL"
cmp -s .env "$O/env.orig" || fail "env changed .env"
rc=0
"$BIN" env </dev/null >>.env 2>"$O/err" || rc=$?
[ "$rc" -eq 1 ] || fail "env >> filled .env exited $rc, want 1"
cmp -s .env "$O/env.orig" || fail "env >> .env changed .env"
rc=0
"$BIN" env </dev/null >.env 2>"$O/err" || rc=$?
[ "$rc" -eq 0 ] || fail "env > .env exited $rc, want 0"
has err "dikosongkan"
cmp -s .env "$O/env" || fail "env > .env did not write the template"

# --- D2: serve and no-arg (not a TTY) refuse when PORT already answers /api/health ---
# Start the binary itself in the background (not via BUNX): $! must be the server, not a subshell that
# `kill` would stop while leaving the server orphaned.
BUN_BE_BUN=1 "$BIN" -e 'const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ version: "0.0.0" }) });
await Bun.write(process.argv[1], String(s.port));' "$O/port" &
SRV=$!
i=0
until [ -s "$O/port" ]; do
  i=$((i + 1))
  [ "$i" -le 50 ] || fail "stub health server did not start"
  sleep 0.1
done
cp "$O/env.orig" .env
printf 'PORT=%s\nPANEL_DATA_DIR=./data\n' "$(cat "$O/port")" >>.env
for args in serve ""; do
  start=$(date +%s)
  # shellcheck disable=SC2086 # "" must expand to no argument at all
  run 1 $args
  [ $(($(date +%s) - start)) -le 3 ] || fail "panel $args took more than 3 s to refuse"
  has err "sudah dipakai"
  [ ! -e data ] || fail "panel $args created the data dir"
done

pid=$SRV
stop_srv
if kill -0 "$pid" 2>/dev/null; then fail "stub health server $pid still running after stop"; fi

echo "cli.test.sh: all passed ($("$BIN" -v </dev/null))"
