#!/bin/sh
# Test of package-release.sh: packs a fake binary, checks assets, tarball layout and checksums.
# Run: sh scripts/package-release.test.sh
set -eu
export LC_ALL=C  # stable sort order for the asset/file lists

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
# macOS without coreutils has shasum only.
if ! command -v sha256sum >/dev/null 2>&1; then
  printf '#!/bin/sh\nexec shasum -a 256 "$@"\n' >"$T/bin/sha256sum"
  chmod 755 "$T/bin/sha256sum"
fi
PATH="$T/bin:$PATH"

fail() { echo "FAIL: $*" >&2; exit 1; }
TAG=v9.9.9-test
OUT="$T/out"
printf 'fake-binary' >"$T/panel-android-arm64"

sh "$HERE/package-release.sh" "$T/panel-android-arm64" "$OUT" "$TAG" >"$T/log" 2>&1 || { cat "$T/log"; fail "package-release.sh failed"; }

# 1. Exactly the three fixed asset names.
[ "$(cd "$OUT" && ls | sort | tr '\n' ' ')" = "SHA256SUMS install.sh panel-termux-android-arm64.tar.gz " ] ||
  fail "unexpected assets: $(ls "$OUT")"

# 2. Tarball holds what install-release.sh / install-phone.sh need, at the paths they expect.
tar -tzf "$OUT/panel-termux-android-arm64.tar.gz" | sort >"$T/list"
printf '%s\n' .env.example LICENSE VERSION deploy/pm2/apps.json deploy/pm2/ecosystem.config.js deploy/pm2/run \
  deploy/sv/panel/run panel-android-arm64 scripts/install-phone.sh | sort >"$T/want"
cmp -s "$T/list" "$T/want" || { diff "$T/want" "$T/list" || true; fail "tarball file list"; }
mkdir "$T/x"
tar -xzf "$OUT/panel-termux-android-arm64.tar.gz" -C "$T/x"
[ "$(cat "$T/x/panel-android-arm64")" = fake-binary ] || fail "binary content"
[ "$(cat "$T/x/VERSION")" = "$TAG" ] || fail "VERSION"
for f in scripts/install-phone.sh deploy/sv/panel/run deploy/pm2/ecosystem.config.js deploy/pm2/apps.json deploy/pm2/run \
  .env.example LICENSE; do
  cmp -s "$T/x/$f" "$REPO/$f" || fail "$f differs from the repo"
done

# 3. install.sh = install-release.sh with only the default version baked in.
grep -q "^PANEL_VERSION_DEFAULT=\"$TAG\"\$" "$OUT/install.sh" || fail "version not baked into install.sh"
[ "$(diff "$REPO/scripts/install-release.sh" "$OUT/install.sh" | grep -c '^[<>]')" = 2 ] || fail "install.sh changed more than one line"

# 4. SHA256SUMS covers both downloadable assets and verifies.
[ "$(awk '{ print $2 }' "$OUT/SHA256SUMS" | sort | tr '\n' ' ')" = "install.sh panel-termux-android-arm64.tar.gz " ] ||
  fail "SHA256SUMS entries"
(cd "$OUT" && sha256sum -c SHA256SUMS >/dev/null) || fail "SHA256SUMS does not verify"

# 5. Bad input is rejected.
if sh "$HERE/package-release.sh" "$T/panel-android-arm64" "$T/o2" >/dev/null 2>&1; then fail "missing tag accepted"; fi
if sh "$HERE/package-release.sh" "$T/panel-android-arm64" "$T/o2" 0.3.0 >/dev/null 2>&1; then fail "tag without v accepted"; fi
if sh "$HERE/package-release.sh" "$T/panel-android-arm64" "$T/o2" 'v1/&x' >/dev/null 2>&1; then fail "unsafe tag accepted"; fi
if sh "$HERE/package-release.sh" "$T/nope" "$T/o2" "$TAG" >/dev/null 2>&1; then fail "missing binary accepted"; fi

echo "package-release.test.sh: all checks passed"
