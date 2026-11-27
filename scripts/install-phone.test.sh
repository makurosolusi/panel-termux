#!/bin/sh
# Stub test of install-phone.sh: temp PREFIX/HOME, fake sv/curl/df/sleep/pm2 on PATH. Run: sh scripts/install-phone.test.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" PREFIX="$T/usr"
mkdir -p "$HOME" "$PREFIX" "$T/bin"
CALLS="$T/calls"
: >"$CALLS"
SVD="$PREFIX/var/service"

# sv fails like the real one when SVDIR is not the service dir; `sv status panel` prints $T/sv_status or "run:".
cat >"$T/bin/sv" <<EOF
#!/bin/sh
[ "\${SVDIR:-}" = "$SVD" ] || { echo "sv: SVDIR not set to $SVD" >&2; exit 1; }
echo "sv \$*" >>"$CALLS"
if [ "\$*" = "status panel" ]; then cat "$T/sv_status" 2>/dev/null || echo "run: panel: (pid 42) 1s"; fi
EOF
# curl succeeds once the panel was restarted, unless $T/curl_fail exists.
cat >"$T/bin/curl" <<EOF
#!/bin/sh
echo "curl \$*" >>"$CALLS"
[ ! -f "$T/curl_fail" ] && grep -q 'restart panel' "$CALLS"
EOF
# df reports $T/df_avail KB free (default: plenty).
cat >"$T/bin/df" <<EOF
#!/bin/sh
echo "Filesystem 1024-blocks Used Available Capacity Mounted"
echo "/dev/fake 99999999 1 \$(cat "$T/df_avail" 2>/dev/null || echo 99999999) 1% /"
EOF
# sleep plays runsvdir: every service dir becomes supervised.
cat >"$T/bin/sleep" <<EOF
#!/bin/sh
for d in "$SVD"/*/; do [ -d "\$d" ] && mkdir -p "\$d/supervise" && : >"\$d/supervise/ok"; done
exit 0
EOF
# The pm2 CLI must never be called.
cat >"$T/bin/pm2" <<EOF
#!/bin/sh
echo "pm2 \$*" >>"$CALLS"
EOF
chmod 755 "$T/bin/"*
PATH="$T/bin:$PATH"
# The phone's ssh shell has no SVDIR; the script must set it itself.
unset SVDIR

fail() { echo "FAIL: $*" >&2; exit 1; }
# GNU first: GNU `stat -f` means filesystem status and prints it to stdout before failing, so a BSD-first fallback returns junk.
mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
# run <expected exit code> <args...>
run() {
  want=$1
  shift
  rc=0
  sh "$HERE/install-phone.sh" "$@" >"$T/out" 2>&1 || rc=$?
  [ "$rc" -eq "$want" ] || { cat "$T/out"; fail "install-phone.sh $* exited $rc, want $want"; }
}
count() { grep -c "$1" "$CALLS" || true; }

printf 'v1' >"$T/bin1"
printf 'v2' >"$T/bin2"
printf 'v3' >"$T/bin3"
SVC="$SVD/panel"

# 1. Fresh install: files in place, .env from example, service held down, exit 3, nothing started, pm2 untouched.
run 3 "$T/bin1"
[ "$(cat "$HOME/panel/panel")" = v1 ] || fail "binary not installed"
[ "$(mode "$HOME/panel/panel")" = 755 ] || fail "binary mode"
[ "$(mode "$HOME/panel/data")" = 700 ] || fail "data dir mode"
[ "$(mode "$HOME/panel/.env")" = 600 ] || fail ".env mode"
cmp -s "$HOME/panel/.env" "$REPO/.env.example" || fail ".env not copied from .env.example"
cmp -s "$SVC/run" "$REPO/deploy/sv/panel/run" || fail "run script not installed"
[ "$(mode "$SVC/run")" = 755 ] || fail "run script mode"
[ "$(readlink "$SVC/log/run")" = "$PREFIX/share/termux-services/svlogger" ] || fail "log/run symlink"
[ -f "$SVC/down" ] || fail "down file missing while .env incomplete"
grep -q GOOGLE_CLIENT_ID "$T/out" || fail "missing vars not reported"
[ ! -s "$CALLS" ] || fail "sv/curl called with incomplete .env"
[ ! -e "$HOME/sites" ] && [ ! -e "$SVD/pm2" ] || fail "pm2 set up while .env incomplete"

# 1b. .env left with the 0.4.0 example placeholders (D7): they count as empty, exit 3 names exactly those two.
{
  echo 'APP_BASE_URL="https://panel.example.com"'
  echo 'GOOGLE_CLIENT_ID=id.apps.googleusercontent.com'
  echo 'GOOGLE_CLIENT_SECRET=x'
  echo 'SUPER_ADMIN_EMAILS=you@example.com'
} >"$HOME/panel/.env"
run 3 "$T/bin1"
grep -q 'Isi APP_BASE_URL SUPER_ADMIN_EMAILS di' "$T/out" || { cat "$T/out"; fail "placeholders not counted as empty"; }
[ ! -s "$CALLS" ] || fail "sv/curl called with placeholder .env"
# The script mirrors ENV_VARS[].placeholders; fail when the schema no longer lists them.
grep -q '"https://panel.example.com"' "$REPO/src/shared/env.schema.ts" || fail "APP_BASE_URL placeholder gone from env.schema.ts"
grep -q '"you@example.com"' "$REPO/src/shared/env.schema.ts" || fail "SUPER_ADMIN_EMAILS placeholder gone from env.schema.ts"

# 2. Fill .env (secret never printed), rerun with the same binary: new-phone pm2 setup, one restart, healthy.
SECRET=test-only-secret-value-123
{
  echo 'APP_BASE_URL=https://panel.example.test'
  echo 'GOOGLE_CLIENT_ID=id.apps.googleusercontent.com'
  echo "GOOGLE_CLIENT_SECRET=\"$SECRET\""
  echo 'SUPER_ADMIN_EMAILS=a@example.test'
  echo 'PORT=3999'
} >"$HOME/panel/.env"
echo keep >"$HOME/panel/data/panel.db"
run 0 "$T/bin1"
grep -q unchanged "$T/out" || fail "same binary should be left alone"
[ ! -f "$HOME/panel/panel.prev" ] || fail "panel.prev created for an unchanged binary"
[ ! -f "$SVC/down" ] || fail "down file not removed"
[ "$(count '^sv -w 130 restart panel$')" = 1 ] || fail "expected exactly one 'sv -w 130 restart panel'"
[ "$(count 'restart')" = 1 ] || fail "restart retried"
grep -q '^sv status panel$' "$CALLS" || fail "sv status not checked after restart"
grep -q 'curl -fsS http://127.0.0.1:3999/api/health' "$CALLS" || fail "health check not on .env PORT"
grep -q 'menunggu sampai 2 menit' "$T/out" || fail "restart wait message missing"
cmp -s "$HOME/sites/ecosystem.config.js" "$REPO/deploy/pm2/ecosystem.config.js" || fail "ecosystem template not copied"
cmp -s "$HOME/sites/apps.json" "$REPO/deploy/pm2/apps.json" || fail "apps.json not copied"
cmp -s "$SVD/pm2/run" "$REPO/deploy/pm2/run" || fail "pm2 run script not copied"
[ "$(mode "$SVD/pm2/run")" = 755 ] || fail "pm2 run script mode"
[ "$(readlink "$SVD/pm2/log/run")" = "$PREFIX/share/termux-services/svlogger" ] || fail "pm2 log/run symlink"
[ ! -e "$SVD/.pm2.new" ] || fail "pm2 staging dir left behind"
grep -q '^sv up pm2$' "$CALLS" || fail "sv up pm2 not called on a new phone"
if grep -q "$SECRET" "$T/out"; then fail "secret printed"; fi

# 3. Upgrade on a phone with pm2 set up: panel.prev kept, .env/data/pm2 untouched.
echo '// owner edit' >>"$HOME/sites/ecosystem.config.js"
cp "$HOME/sites/ecosystem.config.js" "$T/eco.before"
: >"$CALLS"
run 0 "$T/bin2"
[ "$(cat "$HOME/panel/panel")" = v2 ] || fail "binary not upgraded"
[ "$(cat "$HOME/panel/panel.prev")" = v1 ] || fail "panel.prev is not the old binary"
grep -q "$SECRET" "$HOME/panel/.env" || fail ".env overwritten"
[ "$(cat "$HOME/panel/data/panel.db")" = keep ] || fail "data touched"
[ ! -f "$HOME/panel/panel.new" ] || fail "staging file left behind"
cmp -s "$HOME/sites/ecosystem.config.js" "$T/eco.before" || fail "existing ecosystem touched"
grep -q 'pm2 sudah diatur' "$T/out" || fail "existing pm2 message missing"
[ "$(count 'pm2')" = 0 ] || fail "pm2 service/CLI touched on an existing setup"

# 3b. Only the runit pm2 service exists (no ecosystem): still nothing is copied.
rm -rf "$HOME/sites"
run 0 "$T/bin2"
[ ! -e "$HOME/sites" ] || fail "ecosystem copied although \$SVDIR/pm2 exists"

# 3c. D12: current panel unhealthy (no restart seen yet, so the stub health fails) and panel.prev exists → kept.
: >"$CALLS"
run 0 "$T/bin3"
[ "$(cat "$HOME/panel/panel")" = v3 ] || fail "binary not upgraded while unhealthy"
[ "$(cat "$HOME/panel/panel.prev")" = v1 ] || fail "panel.prev overwritten although the running panel was unhealthy"
grep -q 'tidak ditimpa' "$T/out" || fail "kept-panel.prev line missing"
grep -q 'curl -fsS --max-time 5 http://127.0.0.1:3999/api/health' "$CALLS" || fail "pre-swap health not on .env PORT"

# 3d. D12: current panel healthy (the stub answers after the restart above) → panel.prev becomes that binary.
run 0 "$T/bin2"
[ "$(cat "$HOME/panel/panel")" = v2 ] || fail "binary not upgraded while healthy"
[ "$(cat "$HOME/panel/panel.prev")" = v3 ] || fail "panel.prev not updated from the healthy panel"

# 4. Not enough free space: refuse before swapping the binary.
echo 1024 >"$T/df_avail"
run 1 "$T/bin3"
grep -q 'Ruang penyimpanan tidak cukup' "$T/out" || fail "low-space message missing"
[ "$(cat "$HOME/panel/panel")" = v2 ] || fail "binary swapped despite low space"
rm "$T/df_avail"

# 5. Panel not running after the restart: exit 1 with the log path and the rollback hint.
echo 'down: panel: 1s, normally up' >"$T/sv_status"
run 1 "$T/bin3"
grep -q 'Panel belum berjalan setelah 130 dtk' "$T/out" || fail "not-running message missing"
grep -q 'var/log/sv/panel/current' "$T/out" || fail "log path missing"
grep -q "$HOME/panel/panel rollback\$" "$T/out" || fail "rollback hint lacks panel rollback"
grep -q "$HOME/panel/panel rollback --db" "$T/out" || fail "rollback hint lacks panel rollback --db"
if grep -q 'cp .*panel.prev' "$T/out"; then fail "rollback hint still copies panel.prev by hand"; fi
grep -q 'PANEL_SKIP_SNAPSHOT=1' "$T/out" || fail "rollback hint lacks PANEL_SKIP_SNAPSHOT"
rm "$T/sv_status"

# 6. Running but never healthy: exit 1 with the rollback hint.
: >"$T/curl_fail"
run 1 "$T/bin3"
grep -q 'Panel belum sehat' "$T/out" || fail "unhealthy message missing"
grep -q 'panel rollback' "$T/out" || fail "rollback hint missing on health failure"
rm "$T/curl_fail"

# 7. The pm2 CLI was never called in any scenario.
if grep -q '^pm2 ' "$CALLS"; then fail "pm2 CLI called"; fi

# 8. Usage errors.
if sh "$HERE/install-phone.sh" >/dev/null 2>&1; then fail "no-arg run should fail"; fi
if sh "$HERE/install-phone.sh" "$T/nope" >/dev/null 2>&1; then fail "missing binary should fail"; fi

# 9. Template loads under node like pm2 does: missing/broken apps.json or a missing binary leaves only pm2-guard.
if command -v node >/dev/null 2>&1; then
  E="$T/eco"
  mkdir -p "$E/ghost" "$E/blog"
  cp "$REPO/deploy/pm2/ecosystem.config.js" "$E/ecosystem.config.cjs"
  names() { node -e 'console.log(require(process.argv[1]).apps.map((a) => a.name).join(","))' "$E/ecosystem.config.cjs" 2>/dev/null; }
  rm -f "$E/apps.json"
  [ "$(names)" = pm2-guard ] || fail "missing apps.json: $(names)"
  echo '{' >"$E/apps.json"
  [ "$(names)" = pm2-guard ] || fail "broken apps.json: $(names)"
  echo "[{\"name\":\"ghost\",\"cwd\":\"$E/ghost\",\"script\":\"./run\"}]" >"$E/apps.json"
  [ "$(names)" = pm2-guard ] || fail "entry without binary: $(names)"
  : >"$E/blog/run"
  echo "[null,{\"name\":\"ghost\",\"cwd\":\"$E/ghost\",\"script\":\"./run\"},{\"name\":\"blog\",\"cwd\":\"$E/blog\",\"script\":\"./run\"}]" >"$E/apps.json"
  [ "$(names)" = pm2-guard,blog ] || fail "runnable entry not loaded: $(names)"
else
  echo "install-phone.test.sh: node not found, template load check skipped"
fi

echo "install-phone.test.sh: all checks passed"
