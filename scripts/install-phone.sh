#!/bin/sh
# Installs or upgrades the panel on the phone (run IN Termux). Idempotent: safe to rerun.
# Usage: sh scripts/install-phone.sh ./dist/panel-android-arm64
# Expects the repo layout next to it: deploy/sv/panel/run and .env.example (copy them with rsync -R).
# Never prints .env values: only names of missing variables.
set -eu

PREFIX=${PREFIX:-/data/data/com.termux/files/usr}
INSTALL_DIR="$HOME/panel"
# sv resolves "panel" against SVDIR; a non-interactive ssh shell does not set it, so export it here.
SVDIR="$PREFIX/var/service"
export SVDIR
SERVICE_DIR="$SVDIR/panel"
SVLOGGER="$PREFIX/share/termux-services/svlogger"
REQUIRED_VARS="APP_BASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SUPER_ADMIN_EMAILS"
DEFAULT_PORT=3200
SV_WAIT_SEC=15     # runsvdir scans the service dir every ~5 s
HEALTH_WAIT_SEC=30

die() { echo "install-phone: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: sh install-phone.sh <path-to-panel-android-arm64>"
BIN=$1
[ -f "$BIN" ] || die "binary $BIN not found"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN_SRC="$ROOT/deploy/sv/panel/run"
ENV_EXAMPLE="$ROOT/.env.example"
[ -f "$RUN_SRC" ] || die "$RUN_SRC not found (copy deploy/ next to scripts/)"
[ -f "$ENV_EXAMPLE" ] || die "$ENV_EXAMPLE not found"

# 1. Binary: stage next to the live one, keep the old one as panel.prev, then rename (atomic).
mkdir -p "$INSTALL_DIR"
if [ -f "$INSTALL_DIR/panel" ] && cmp -s "$BIN" "$INSTALL_DIR/panel"; then
  echo "binary unchanged"
  CHANGED=0
else
  cp "$BIN" "$INSTALL_DIR/panel.new"
  chmod 755 "$INSTALL_DIR/panel.new"
  [ -f "$INSTALL_DIR/panel" ] && cp -p "$INSTALL_DIR/panel" "$INSTALL_DIR/panel.prev"
  mv -f "$INSTALL_DIR/panel.new" "$INSTALL_DIR/panel"
  echo "binary installed: $INSTALL_DIR/panel"
  CHANGED=1
fi

# 2. Data dir (panel.db + data secret) and .env (never overwritten).
mkdir -p "$INSTALL_DIR/data"
chmod 700 "$INSTALL_DIR/data"
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "created $ENV_FILE from .env.example"
fi
chmod 600 "$ENV_FILE"

# 3. runit service dir; `down` keeps runsv from starting the panel until .env is complete.
mkdir -p "$SERVICE_DIR/log"
cp "$RUN_SRC" "$SERVICE_DIR/run.new"
chmod 755 "$SERVICE_DIR/run.new"
mv -f "$SERVICE_DIR/run.new" "$SERVICE_DIR/run"
ln -sfn "$SVLOGGER" "$SERVICE_DIR/log/run"

missing=""
for v in $REQUIRED_VARS; do
  # Non-empty value, optionally quoted; the value itself is never echoed.
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$v=[\"']?[^\"'[:space:]#]" "$ENV_FILE" || missing="$missing $v"
done
if [ -n "$missing" ]; then
  touch "$SERVICE_DIR/down"
  echo "fill in$missing in $ENV_FILE (chmod 600), then rerun this script"
  exit 0
fi
rm -f "$SERVICE_DIR/down"

# 4. Start, or restart so a new binary/run script takes effect (sv restart also starts a stopped service).
i=0
until sv restart panel >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt "$SV_WAIT_SEC" ] || die "sv restart panel failed (is service-daemon running?)"
  sleep 1
done
[ "$CHANGED" -eq 1 ] && [ -f "$INSTALL_DIR/panel.prev" ] && echo "previous binary kept as $INSTALL_DIR/panel.prev"

PORT=$(sed -n 's/^[[:space:]]*PORT=["'\'']\{0,1\}\([0-9][0-9]*\).*/\1/p' "$ENV_FILE" | tail -n 1)
URL="http://127.0.0.1:${PORT:-$DEFAULT_PORT}/api/health"
i=0
until curl -fsS "$URL" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt "$HEALTH_WAIT_SEC" ] || die "panel not healthy after ${HEALTH_WAIT_SEC}s; see $PREFIX/var/log/sv/panel/current"
  sleep 1
done
echo "panel healthy at $URL"
