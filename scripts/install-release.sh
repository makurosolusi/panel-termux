#!/bin/sh
# Installs or upgrades Panel Termux from a GitHub release (run IN Termux). Published as the release asset install.sh:
#   curl -fsSLo install.sh https://github.com/makurosolusi/panel-termux/releases/latest/download/install.sh && sh install.sh
# Version: $PANEL_VERSION, else PANEL_VERSION_DEFAULT (set by scripts/package-release.sh at release time).
# The tarball is checked against SHA256SUMS before it is extracted; then scripts/install-phone.sh runs.
# Exit codes: 0 = panel running, 1 = error, 3 = ~/panel/.env incomplete (fill it in, then run this again).
set -eu

PANEL_VERSION_DEFAULT=""
VERSION=${PANEL_VERSION:-$PANEL_VERSION_DEFAULT}
RELEASES_URL=${PANEL_RELEASES_URL:-https://github.com/makurosolusi/panel-termux/releases/download}
README_URL="https://github.com/makurosolusi/panel-termux#readme"
README_INSTALL_URL="https://github.com/makurosolusi/panel-termux#instal-di-hp"
TARBALL=panel-termux-android-arm64.tar.gz
PREFIX=${PREFIX:-/data/data/com.termux/files/usr}
SRC_DIR="$HOME/panel-src/$VERSION"
MIN_FREE_KB=409600  # 400 MB
EXIT_ENV_INCOMPLETE=3

die() { echo "install: $*" >&2; exit 1; }

[ "$(uname -m)" = aarch64 ] || die "Panel Termux butuh HP Android 64-bit (arm64)."
[ -n "$VERSION" ] || die "Versi tidak diketahui: set PANEL_VERSION, misalnya PANEL_VERSION=v0.3.0 sh install.sh"
[ -d "$PREFIX" ] || die "$PREFIX tidak ada: jalankan skrip ini di Termux."
for tool in curl tar sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool tidak ditemukan: pkg install $tool"
done
[ -e "$PREFIX/share/termux-services/svlogger" ] ||
  die "pkg install termux-services, lalu tutup dan buka lagi Termux, lalu jalankan skrip ini lagi."
command -v cloudflared >/dev/null 2>&1 ||
  echo "Peringatan: tanpa cloudflared, panel tidak bisa dibuka dari luar HP." >&2

free_kb() { df -Pk "$HOME" | awk 'NR == 2 { print $4 }'; }
no_space() { die "Ruang penyimpanan tidak cukup: butuh $(($1 / 1024)) MB kosong di $HOME, tersedia $(($(free_kb) / 1024)) MB."; }
[ "$(free_kb)" -ge "$MIN_FREE_KB" ] || no_space "$MIN_FREE_KB"

TMP=$(mktemp -d "${TMPDIR:-$PREFIX/tmp}/panel-install.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# download <asset>: 404 means the version was never released; anything else is a network/server error.
download() {
  code=$(curl -sSL -o "$TMP/$1" -w '%{http_code}' "$RELEASES_URL/$VERSION/$1") || code=000
  case "$code" in
    200) ;;
    404) die "Belum ada rilis yang bisa dipasang ($VERSION). Lihat halaman Releases di GitHub." ;;
    *) die "Gagal mengunduh $1 (HTTP $code). Periksa koneksi, lalu ulangi." ;;
  esac
}

if [ -f "$SRC_DIR/$TARBALL" ] && (cd "$SRC_DIR" && sha256sum -c --ignore-missing --status SHA256SUMS) 2>/dev/null; then
  echo "$TARBALL $VERSION sudah diunduh dan cocok dengan SHA256SUMS"
else
  download SHA256SUMS
  download "$TARBALL"
  (cd "$TMP" && sha256sum -c --ignore-missing SHA256SUMS) ||
    die "Checksum tidak cocok: unduhan rusak. Ulangi; untuk memastikan asal rilis, pakai gh attestation verify."
  size_kb=$(($(wc -c <"$TMP/$TARBALL") / 1024))
  need_kb=$((3 * size_kb))
  [ "$need_kb" -ge "$MIN_FREE_KB" ] || need_kb=$MIN_FREE_KB
  [ "$(free_kb)" -ge "$need_kb" ] || no_space "$need_kb"
  rm -rf "$SRC_DIR"
  mkdir -p "$SRC_DIR"
  # Keeping the verified tarball + SHA256SUMS lets a rerun skip the download.
  mv "$TMP/$TARBALL" "$TMP/SHA256SUMS" "$SRC_DIR/"
fi

tar -xzf "$SRC_DIR/$TARBALL" -C "$SRC_DIR"
rc=0
(cd "$SRC_DIR" && sh scripts/install-phone.sh ./panel-android-arm64) || rc=$?
case "$rc" in
  0) echo "Panel menyala. Lanjutkan: hubungkan Cloudflare Tunnel dan pasang Access (README langkah 3–4: $README_INSTALL_URL)." ;;
  "$EXIT_ENV_INCOMPLETE")
    echo "Langkah berikutnya: buat OAuth client Google (panduan: $README_URL), isi ~/panel/.env, lalu jalankan sh install.sh lagi."
    ;;
esac
exit "$rc"
