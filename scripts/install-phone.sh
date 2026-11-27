#!/bin/sh
# Installs or upgrades the panel on the phone (run IN Termux). Idempotent: safe to rerun.
# Usage: sh scripts/install-phone.sh ./panel-android-arm64
# Expects the repo/tarball layout next to it: deploy/sv/panel/run, deploy/pm2/* and .env.example.
# Exit codes: 0 = panel running and healthy, 1 = error, 3 = ~/panel/.env incomplete (fill it in, then rerun).
# Never prints .env values (only names of missing variables) and never calls the pm2 CLI.
set -eu

PREFIX=${PREFIX:-/data/data/com.termux/files/usr}
INSTALL_DIR="$HOME/panel"
SITES_DIR="$HOME/sites"
# sv resolves "panel" against SVDIR; a non-interactive ssh shell does not set it, so export it here.
SVDIR="$PREFIX/var/service"
export SVDIR
SERVICE_DIR="$SVDIR/panel"
SVLOGGER="$PREFIX/share/termux-services/svlogger"
PANEL_LOG="$PREFIX/var/log/sv/panel/current"
ENV_FILE="$INSTALL_DIR/.env"
REQUIRED_VARS="APP_BASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SUPER_ADMIN_EMAILS"
DEFAULT_PORT=3200
SUPERVISE_WAIT_SEC=15  # runsvdir scans the service dir every ~5 s
RESTART_WAIT_SEC=130   # panel shutdown waits up to 120 s for a running site change (PLAN/03 §4.12)
HEALTH_WAIT_SEC=30
HEALTH_PROBE_SEC=5
SNAPSHOT_MARGIN_KB=262144  # 256 MB on top of 2 x panel.db for the boot-time snapshot (PLAN/04 K9)
EXIT_ENV_INCOMPLETE=3

die() { echo "install-phone: $*" >&2; exit 1; }

# Printed when the new binary does not come up; `panel rollback` swaps panel.prev back without executing it.
rollback_hint() {
  cat >&2 <<EOF
Untuk kembali ke versi sebelumnya:
  $INSTALL_DIR/panel rollback
  $INSTALL_DIR/panel rollback --db   # bila versi baru sudah memigrasi database (snapshot terbaru, dibuat panel saat boot)
Bila log menyebut snapshot gagal karena ruang penuh, kosongkan ruang atau tambahkan PANEL_SKIP_SNAPSHOT=1 ke $INSTALL_DIR/.env.
EOF
}

# Last PORT in .env (digits only), else the default.
env_port() {
  p=""
  [ -f "$ENV_FILE" ] && p=$(sed -n 's/^[[:space:]]*PORT=["'\'']\{0,1\}\([0-9][0-9]*\).*/\1/p' "$ENV_FILE" | tail -n 1)
  echo "${p:-$DEFAULT_PORT}"
}

# Old .env.example (<= 0.4.0) placeholders count as empty: mirror of ENV_VARS[].placeholders in src/shared/env.schema.ts (D7).
placeholder_of() {
  case $1 in
    APP_BASE_URL) echo "https://panel.example.com" ;;
    SUPER_ADMIN_EMAILS) echo "you@example.com" ;;
  esac
}

# True when $1 has a real value in .env: non-empty, optionally quoted, not a placeholder. The value is never echoed.
env_filled() {
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1=[\"']?[^\"'[:space:]#]" "$ENV_FILE" || return 1
  ph=$(placeholder_of "$1")
  [ -n "$ph" ] || return 0
  val=$(sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1=//p" "$ENV_FILE" | tail -n 1 |
    sed "s/[[:space:]]*\$//; s/^[\"']//; s/[\"']\$//")
  [ "$val" != "$ph" ]
}

fail_started() {
  echo "install-phone: $*" >&2
  [ -f "$INSTALL_DIR/panel.prev" ] && rollback_hint
  exit 1
}

# Waits until runsv supervises the service (supervise/ok exists); sv fails before that.
wait_supervised() {
  i=0
  until [ -e "$SVDIR/$1/supervise/ok" ]; do
    i=$((i + 1))
    [ "$i" -le "$SUPERVISE_WAIT_SEC" ] || return 1
    sleep 1
  done
}

[ $# -eq 1 ] || die "usage: sh install-phone.sh <path-to-panel-android-arm64>"
BIN=$1
[ -f "$BIN" ] || die "binary $BIN not found"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN_SRC="$ROOT/deploy/sv/panel/run"
PM2_SRC="$ROOT/deploy/pm2"
ENV_EXAMPLE="$ROOT/.env.example"
for f in "$RUN_SRC" "$ENV_EXAMPLE" "$PM2_SRC/ecosystem.config.js" "$PM2_SRC/apps.json" "$PM2_SRC/run"; do
  [ -f "$f" ] || die "$f not found (copy deploy/ and .env.example next to scripts/)"
done

# 1. Binary: preflight space, stage next to the live one, keep the old one as panel.prev, then rename (atomic).
mkdir -p "$INSTALL_DIR"
if [ -f "$INSTALL_DIR/panel" ] && cmp -s "$BIN" "$INSTALL_DIR/panel"; then
  echo "binary unchanged"
else
  # ponytail: assumes the default PANEL_DATA_DIR (./data); a custom data dir is not measured.
  db_kb=0
  [ -f "$INSTALL_DIR/data/panel.db" ] && db_kb=$(( $(wc -c <"$INSTALL_DIR/data/panel.db") / 1024 ))
  need_kb=$((2 * db_kb + SNAPSHOT_MARGIN_KB))
  avail_kb=$(df -Pk "$INSTALL_DIR" | awk 'NR == 2 { print $4 }')
  [ "${avail_kb:-0}" -ge "$need_kb" ] ||
    die "Ruang penyimpanan tidak cukup: butuh $((need_kb / 1024)) MB kosong (2 x panel.db + 256 MB untuk snapshot saat boot), tersedia $((${avail_kb:-0} / 1024)) MB. Binary lama tidak diubah."
  cp "$BIN" "$INSTALL_DIR/panel.new"
  chmod 755 "$INSTALL_DIR/panel.new"
  # D12: panel.prev is replaced only by a binary known to work (the running panel answers /api/health) or when there is
  # none yet, so rerunning a broken upgrade never overwrites the last good binary.
  if [ -f "$INSTALL_DIR/panel" ]; then
    if [ ! -f "$INSTALL_DIR/panel.prev" ] ||
      curl -fsS --max-time "$HEALTH_PROBE_SEC" "http://127.0.0.1:$(env_port)/api/health" >/dev/null 2>&1; then
      cp -p "$INSTALL_DIR/panel" "$INSTALL_DIR/panel.prev"
      echo "previous binary kept as $INSTALL_DIR/panel.prev"
    else
      echo "Panel sekarang tidak sehat: $INSTALL_DIR/panel.prev (versi terakhir yang sehat) tidak ditimpa."
    fi
  fi
  mv -f "$INSTALL_DIR/panel.new" "$INSTALL_DIR/panel"
  echo "binary installed: $INSTALL_DIR/panel"
fi

# 2. Data dir (panel.db + data secret) and .env (never overwritten).
mkdir -p "$INSTALL_DIR/data"
chmod 700 "$INSTALL_DIR/data"
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
  env_filled "$v" || missing="$missing $v"
done
if [ -n "$missing" ]; then
  touch "$SERVICE_DIR/down"
  echo "Isi$missing di $ENV_FILE (chmod 600), lalu jalankan skrip ini lagi."
  exit "$EXIT_ENV_INCOMPLETE"
fi
rm -f "$SERVICE_DIR/down"

# 4. pm2: only on a new phone (no ecosystem and no runit pm2 service). An existing setup is never touched.
if [ ! -e "$SITES_DIR/ecosystem.config.js" ] && [ ! -e "$SVDIR/pm2" ]; then
  mkdir -p "$SITES_DIR"
  cp "$PM2_SRC/ecosystem.config.js" "$PM2_SRC/apps.json" "$SITES_DIR/"
  # Built under a dot name (runsvdir ignores it) and renamed, so runsv never sees a half-copied dir.
  rm -rf "$SVDIR/.pm2.new"
  mkdir -p "$SVDIR/.pm2.new/log"
  cp "$PM2_SRC/run" "$SVDIR/.pm2.new/run"
  chmod 755 "$SVDIR/.pm2.new/run"
  ln -sfn "$SVLOGGER" "$SVDIR/.pm2.new/log/run"
  mv "$SVDIR/.pm2.new" "$SVDIR/pm2"
  [ -f "$PREFIX/lib/node_modules/pm2/bin/pm2-runtime" ] ||
    echo "Peringatan: pm2 belum terpasang (pkg install nodejs, lalu npm install -g pm2); layanan pm2 baru jalan setelah itu." >&2
  wait_supervised pm2 || die "runit belum mengawasi layanan pm2 setelah ${SUPERVISE_WAIT_SEC} dtk (apakah service-daemon jalan?)"
  sv up pm2
  echo "pm2 diatur: $SITES_DIR/ecosystem.config.js, $SITES_DIR/apps.json dan layanan runit pm2."
else
  echo "pm2 sudah diatur; buka Situs → Persiapan di panel untuk memeriksa integrasi."
fi

# 5. One restart (also starts a stopped service). Shutdown waits for a running site change, hence the long -w.
wait_supervised panel || die "runit belum mengawasi layanan panel setelah ${SUPERVISE_WAIT_SEC} dtk (apakah service-daemon jalan?)"
echo "Memulai ulang panel. Bila ada perubahan situs yang sedang berjalan, panel menunggu sampai 2 menit."
rc=0
sv -w "$RESTART_WAIT_SEC" restart panel >/dev/null 2>&1 || rc=$?
case "$(sv status panel 2>/dev/null)" in
  run:*) ;;
  *) fail_started "Panel belum berjalan setelah $RESTART_WAIT_SEC dtk (sv restart kode $rc). Lihat $PANEL_LOG." ;;
esac

URL="http://127.0.0.1:$(env_port)/api/health"
i=0
until curl -fsS "$URL" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt "$HEALTH_WAIT_SEC" ] || fail_started "Panel belum sehat setelah ${HEALTH_WAIT_SEC} dtk. Lihat $PANEL_LOG."
  sleep 1
done
echo "panel healthy at $URL"
