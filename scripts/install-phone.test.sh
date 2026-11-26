#!/bin/sh
# Stub test of install-phone.sh: temp PREFIX/HOME, fake `sv`/`curl` on PATH. Run: sh scripts/install-phone.test.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" PREFIX="$T/usr"
mkdir -p "$HOME" "$PREFIX" "$T/bin"
CALLS="$T/calls"
: >"$CALLS"

# Stubs record their arguments; curl fails until the panel was (re)started once.
cat >"$T/bin/sv" <<EOF
#!/bin/sh
echo "sv \$*" >>"$CALLS"
EOF
cat >"$T/bin/curl" <<EOF
#!/bin/sh
echo "curl \$*" >>"$CALLS"
grep -q '^sv restart panel' "$CALLS"
EOF
chmod 755 "$T/bin/sv" "$T/bin/curl"
PATH="$T/bin:$PATH"

fail() { echo "FAIL: $*" >&2; exit 1; }
mode() { stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1"; }
run() { sh "$HERE/install-phone.sh" "$@" >"$T/out" 2>&1 || { cat "$T/out"; fail "install-phone.sh $* exited non-zero"; }; }

printf 'v1' >"$T/bin1"
printf 'v2' >"$T/bin2"
SVC="$PREFIX/var/service/panel"

# 1. Fresh install: files in place, .env from example, service held down, nothing started.
run "$T/bin1"
[ "$(cat "$HOME/panel/panel")" = v1 ] || fail "binary not installed"
[ "$(mode "$HOME/panel/panel")" = 755 ] || fail "binary mode"
[ "$(mode "$HOME/panel/data")" = 700 ] || fail "data dir mode"
[ "$(mode "$HOME/panel/.env")" = 600 ] || fail ".env mode"
cmp -s "$HOME/panel/.env" "$HERE/../.env.example" || fail ".env not copied from .env.example"
cmp -s "$SVC/run" "$HERE/../deploy/sv/panel/run" || fail "run script not installed"
[ "$(mode "$SVC/run")" = 755 ] || fail "run script mode"
[ "$(readlink "$SVC/log/run")" = "$PREFIX/share/termux-services/svlogger" ] || fail "log/run symlink"
[ -f "$SVC/down" ] || fail "down file missing while .env incomplete"
grep -q GOOGLE_CLIENT_ID "$T/out" || fail "missing vars not reported"
[ ! -s "$CALLS" ] || fail "sv/curl called with incomplete .env"

# 2. Fill .env (secret value must never be printed), rerun with the same binary: started + health checked.
SECRET=test-only-secret-value-123
{
  echo 'APP_BASE_URL=https://panel.example.test'
  echo 'GOOGLE_CLIENT_ID=id.apps.googleusercontent.com'
  echo "GOOGLE_CLIENT_SECRET=\"$SECRET\""
  echo 'SUPER_ADMIN_EMAILS=a@example.test'
  echo 'PORT=3999'
} >"$HOME/panel/.env"
echo keep >"$HOME/panel/data/panel.db"
run "$T/bin1"
grep -q unchanged "$T/out" || fail "same binary should be left alone"
[ ! -f "$HOME/panel/panel.prev" ] || fail "panel.prev created for an unchanged binary"
[ ! -f "$SVC/down" ] || fail "down file not removed"
grep -q '^sv restart panel' "$CALLS" || fail "sv restart not called"
grep -q 'curl -fsS http://127.0.0.1:3999/api/health' "$CALLS" || fail "health check not on .env PORT"
if grep -q "$SECRET" "$T/out"; then fail "secret printed"; fi

# 3. Upgrade: new binary, old kept as panel.prev, .env and data untouched.
run "$T/bin2"
[ "$(cat "$HOME/panel/panel")" = v2 ] || fail "binary not upgraded"
[ "$(cat "$HOME/panel/panel.prev")" = v1 ] || fail "panel.prev is not the old binary"
grep -q "$SECRET" "$HOME/panel/.env" || fail ".env overwritten"
[ "$(cat "$HOME/panel/data/panel.db")" = keep ] || fail "data touched"
[ ! -f "$HOME/panel/panel.new" ] || fail "staging file left behind"

# 4. Usage errors.
if sh "$HERE/install-phone.sh" >/dev/null 2>&1; then fail "no-arg run should fail"; fi
if sh "$HERE/install-phone.sh" "$T/nope" >/dev/null 2>&1; then fail "missing binary should fail"; fi

echo "install-phone.test.sh: all checks passed"
