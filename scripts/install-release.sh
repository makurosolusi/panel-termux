#!/bin/sh
# Compatibility shim for 0.5.x upgrades (kept through 0.6.x, removed in 0.7.0, PLAN/07 §8.2), published as the release asset install.sh.
# Downloads the raw `panel` binary of one release, checks it against that release's SHA256SUMS, then runs
# `panel init` (which does all the installing). Version: $PANEL_VERSION, else PANEL_VERSION_DEFAULT (set by
# scripts/package-release.sh). Arguments are passed to `panel init`. Exit code = exit code of `panel init`.
# Messages are English only: no binary (and so no language choice) exists yet; `panel init` asks for it (PLAN/08 §6).
set -eu

PANEL_VERSION_DEFAULT=""
VERSION=${PANEL_VERSION:-$PANEL_VERSION_DEFAULT}
RELEASES_URL=${PANEL_RELEASES_URL:-https://github.com/makurosolusi/panel-termux/releases/download}
PREFIX=${PREFIX:-/data/data/com.termux/files/usr}

die() { echo "install: $*" >&2; exit 1; }

[ "$(uname -m)" = aarch64 ] || die "Panel Termux needs a 64-bit Android phone (arm64)."
[ -n "$VERSION" ] || die "Unknown version: set PANEL_VERSION, for example PANEL_VERSION=v0.5.1 sh install.sh"
[ -d "$PREFIX" ] || die "$PREFIX does not exist: run this script in Termux."
for tool in curl sha256sum; do command -v "$tool" >/dev/null 2>&1 || die "$tool not found: pkg install $tool"; done

TMP=$(mktemp -d "${TMPDIR:-$PREFIX/tmp}/panel-install.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
for asset in SHA256SUMS panel; do
  curl -fsSL --retry 3 -o "$TMP/$asset" "$RELEASES_URL/$VERSION/$asset" ||
    die "Downloading $asset $VERSION failed. Check the connection and try again (or this version is not released yet)."
done
(cd "$TMP" && sha256sum -c --ignore-missing SHA256SUMS) || die "Checksum mismatch: the download is corrupt. Try again."
chmod 755 "$TMP/panel"
# exec replaces the shell, so the trap never removes $TMP: `panel init` deletes its own download (K24).
# ponytail: one empty folder per shim run stays in $TMPDIR; the shim goes away in 0.7.0.
BIN="$TMP/panel"
# D6: under `curl … | sh` stdin is the pipe; give init the terminal when there is one.
if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then exec "$BIN" init "$@" </dev/tty; else exec "$BIN" init "$@"; fi
