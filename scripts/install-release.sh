#!/bin/sh
# Compatibility shim for 0.5.x (removed in 0.6.0, PLAN/07 §8.2), published as the release asset install.sh.
# Downloads the raw `panel` binary of one release, checks it against that release's SHA256SUMS, then runs
# `panel init` (which does all the installing). Version: $PANEL_VERSION, else PANEL_VERSION_DEFAULT (set by
# scripts/package-release.sh). Arguments are passed to `panel init`. Exit code = exit code of `panel init`.
set -eu

PANEL_VERSION_DEFAULT=""
VERSION=${PANEL_VERSION:-$PANEL_VERSION_DEFAULT}
RELEASES_URL=${PANEL_RELEASES_URL:-https://github.com/makurosolusi/panel-termux/releases/download}
PREFIX=${PREFIX:-/data/data/com.termux/files/usr}

die() { echo "install: $*" >&2; exit 1; }

[ "$(uname -m)" = aarch64 ] || die "Panel Termux butuh HP Android 64-bit (arm64)."
[ -n "$VERSION" ] || die "Versi tidak diketahui: set PANEL_VERSION, misalnya PANEL_VERSION=v0.5.1 sh install.sh"
[ -d "$PREFIX" ] || die "$PREFIX tidak ada: jalankan skrip ini di Termux."
for tool in curl sha256sum; do command -v "$tool" >/dev/null 2>&1 || die "$tool tidak ditemukan: pkg install $tool"; done

TMP=$(mktemp -d "${TMPDIR:-$PREFIX/tmp}/panel-install.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
for asset in SHA256SUMS panel; do
  curl -fsSL --retry 3 -o "$TMP/$asset" "$RELEASES_URL/$VERSION/$asset" ||
    die "Gagal mengunduh $asset $VERSION. Periksa koneksi lalu ulangi (atau versi ini belum dirilis)."
done
(cd "$TMP" && sha256sum -c --ignore-missing SHA256SUMS) || die "Checksum tidak cocok: unduhan rusak. Ulangi."
chmod 755 "$TMP/panel"
# exec replaces the shell, so the trap never removes $TMP: `panel init` deletes its own download (K24).
# ponytail: one empty folder per shim run stays in $TMPDIR; the shim goes away in 0.6.0.
BIN="$TMP/panel"
# D6: under `curl … | sh` stdin is the pipe; give init the terminal when there is one.
if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then exec "$BIN" init "$@" </dev/tty; else exec "$BIN" init "$@"; fi
