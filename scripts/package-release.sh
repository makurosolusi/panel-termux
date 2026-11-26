#!/bin/sh
# Packages the release assets (run by .github/workflows/release.yml, or locally).
# Usage: sh scripts/package-release.sh <binary> <outdir> <tag>
# Writes <outdir>/panel-termux-android-arm64.tar.gz, <outdir>/install.sh (install-release.sh with the tag baked in)
# and <outdir>/SHA256SUMS covering both.
set -eu

die() { echo "package-release: $*" >&2; exit 1; }

[ $# -eq 3 ] || die "usage: sh scripts/package-release.sh <binary> <outdir> <tag>"
BIN=$1
OUT=$2
TAG=$3
case "$TAG" in
  *[!0-9A-Za-z.-]*) die "tag may only contain letters, digits, '.' and '-', got '$TAG'" ;;
  v[0-9]*) ;;
  *) die "tag must look like v1.2.3, got '$TAG'" ;;
esac
[ -f "$BIN" ] || die "binary $BIN not found"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARBALL=panel-termux-android-arm64.tar.gz

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/scripts" "$STAGE/deploy/sv/panel" "$STAGE/deploy/pm2" "$OUT"
cp "$BIN" "$STAGE/panel-android-arm64"
chmod 755 "$STAGE/panel-android-arm64"
cp "$ROOT/scripts/install-phone.sh" "$STAGE/scripts/"
cp "$ROOT/deploy/sv/panel/run" "$STAGE/deploy/sv/panel/"
# install-phone.sh copies these onto a phone that has no pm2 setup yet (PLAN/03 §7.2).
cp "$ROOT/deploy/pm2/ecosystem.config.js" "$ROOT/deploy/pm2/apps.json" "$ROOT/deploy/pm2/run" "$STAGE/deploy/pm2/"
cp "$ROOT/.env.example" "$ROOT/LICENSE" "$STAGE/"
echo "$TAG" >"$STAGE/VERSION"

# Fixed file order; COPYFILE_DISABLE keeps macOS tar from adding ._ metadata files.
COPYFILE_DISABLE=1 tar -czf "$OUT/$TARBALL" -C "$STAGE" \
  panel-android-arm64 scripts/install-phone.sh deploy/sv/panel/run \
  deploy/pm2/ecosystem.config.js deploy/pm2/apps.json deploy/pm2/run .env.example LICENSE VERSION

grep -q '^PANEL_VERSION_DEFAULT=""$' "$ROOT/scripts/install-release.sh" ||
  die "scripts/install-release.sh lost its PANEL_VERSION_DEFAULT=\"\" line"
sed "s/^PANEL_VERSION_DEFAULT=\"\"\$/PANEL_VERSION_DEFAULT=\"$TAG\"/" "$ROOT/scripts/install-release.sh" >"$OUT/install.sh"

(cd "$OUT" && sha256sum "$TARBALL" install.sh >SHA256SUMS)
echo "packaged $TAG into $OUT: $TARBALL install.sh SHA256SUMS"
