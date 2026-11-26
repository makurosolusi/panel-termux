#!/bin/sh
# Stub test of install-release.sh (published as install.sh): fake uname/curl/df on PATH, a real release built by
# package-release.sh from a copy of the repo whose install-phone.sh is a stub. Run: sh scripts/install-release.test.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" PREFIX="$T/usr" TMPDIR="$T/tmp"
mkdir -p "$HOME" "$PREFIX/share/termux-services" "$TMPDIR" "$T/bin" "$T/root/scripts" "$T/rel"
: >"$PREFIX/share/termux-services/svlogger"
CALLS="$T/calls"
: >"$CALLS"
TAG=v9.9.9-test
export PANEL_RELEASES_URL=https://releases.example.test/download

# PATH is cut down to $T/bin + system dirs below (so a real cloudflared is hidden); keep sha256sum reachable.
if command -v sha256sum >/dev/null 2>&1; then
  ln -s "$(command -v sha256sum)" "$T/bin/sha256sum"
else
  printf '#!/bin/sh\nexec shasum -a 256 "$@"\n' >"$T/bin/sha256sum"
fi
echo aarch64 >"$T/arch"
printf '#!/bin/sh\ncat "%s"\n' "$T/arch" >"$T/bin/uname"
# curl -sSL -o <file> -w '%{http_code}' <url>: serves $T/rel/<version>/<asset>, else 404.
cat >"$T/bin/curl" <<EOF
#!/bin/sh
out=""
while [ \$# -gt 1 ]; do
  [ "\$1" = -o ] && { out=\$2; shift; }
  shift
done
echo "curl \$1" >>"$CALLS"
src="$T/rel/\${1#$PANEL_RELEASES_URL/}"
if [ -f "\$src" ]; then cp "\$src" "\$out"; printf 200; else printf 404; fi
EOF
cat >"$T/bin/df" <<EOF
#!/bin/sh
echo "Filesystem 1024-blocks Used Available Capacity Mounted"
echo "/dev/fake 99999999 1 \$(cat "$T/df_avail" 2>/dev/null || echo 99999999) 1% /"
EOF
chmod 755 "$T/bin/uname" "$T/bin/curl" "$T/bin/df"
[ -L "$T/bin/sha256sum" ] || chmod 755 "$T/bin/sha256sum"
PATH="$T/bin:/usr/bin:/bin"

# A release built from the real packaging script, with install-phone.sh replaced by a recording stub.
cp -R "$REPO/deploy" "$T/root/"
cp "$REPO/.env.example" "$REPO/LICENSE" "$T/root/"
cp "$REPO/scripts/package-release.sh" "$REPO/scripts/install-release.sh" "$T/root/scripts/"
cat >"$T/root/scripts/install-phone.sh" <<EOF
#!/bin/sh
echo "install-phone \$* in \$(pwd) mode=\$(ls -l panel-android-arm64 | cut -c1-10)" >>"$CALLS"
exit \$(cat "$T/phone_rc" 2>/dev/null || echo 0)
EOF
printf 'fake-binary' >"$T/panel-android-arm64"
sh "$T/root/scripts/package-release.sh" "$T/panel-android-arm64" "$T/rel/$TAG" "$TAG" >/dev/null
INSTALL="$T/rel/$TAG/install.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
run() {
  want=$1
  rc=0
  sh "$INSTALL" >"$T/out" 2>&1 || rc=$?
  [ "$rc" -eq "$want" ] || { cat "$T/out"; fail "install.sh exited $rc, want $want"; }
}
downloads() { grep -c '^curl ' "$CALLS" || true; }

# 1. Not arm64: refuse before downloading anything.
echo x86_64 >"$T/arch"
run 1
grep -q 'butuh HP Android 64-bit (arm64)' "$T/out" || fail "arch message"
[ "$(downloads)" = 0 ] || fail "downloaded on a non-arm64 phone"
echo aarch64 >"$T/arch"

# 2. termux-services missing.
mv "$PREFIX/share/termux-services/svlogger" "$T/svlogger"
run 1
grep -q 'pkg install termux-services' "$T/out" || fail "termux-services message"
mv "$T/svlogger" "$PREFIX/share/termux-services/svlogger"

# 3. Too little free space: refuse before downloading.
echo 1024 >"$T/df_avail"
run 1
grep -q 'Ruang penyimpanan tidak cukup' "$T/out" || fail "low-space message"
[ "$(downloads)" = 0 ] || fail "downloaded without space"
rm "$T/df_avail"

# 4. Fresh install of the baked-in version: verified, extracted, install-phone.sh run from the extracted tree.
run 0
SRC="$HOME/panel-src/$TAG"
grep -q "^curl $PANEL_RELEASES_URL/$TAG/SHA256SUMS\$" "$CALLS" || fail "SHA256SUMS not downloaded"
grep -q "^curl $PANEL_RELEASES_URL/$TAG/panel-termux-android-arm64.tar.gz\$" "$CALLS" || fail "tarball not downloaded"
[ "$(cat "$SRC/VERSION")" = "$TAG" ] || fail "not extracted to ~/panel-src/<version>"
grep -q "^install-phone ./panel-android-arm64 in $SRC " "$CALLS" || fail "install-phone.sh not run in the extracted tree"
grep -q 'Panel menyala' "$T/out" || fail "success message"
grep -q 'tanpa cloudflared' "$T/out" || fail "cloudflared warning missing"
[ -z "$(ls "$TMPDIR")" ] || fail "temp dir not cleaned"

# 5. Rerun: the cached, verified tarball is reused without downloading.
: >"$CALLS"
run 0
[ "$(downloads)" = 0 ] || fail "cached release downloaded again"
grep -q 'sudah diunduh' "$T/out" || fail "cache message"

# 6. .env incomplete (install-phone exit 3): exit 3 with the next steps.
echo 3 >"$T/phone_rc"
run 3
grep -q 'isi ~/panel/.env' "$T/out" || fail "next steps for exit 3"
rm "$T/phone_rc"

# 7. Corrupt tarball: checksum fails, nothing extracted, install-phone.sh never runs.
BAD=v9.9.8-test
mkdir "$T/rel/$BAD"
cp "$T/rel/$TAG/SHA256SUMS" "$T/rel/$BAD/"
{ cat "$T/rel/$TAG/panel-termux-android-arm64.tar.gz"; printf 'x'; } >"$T/rel/$BAD/panel-termux-android-arm64.tar.gz"
: >"$CALLS"
export PANEL_VERSION=$BAD
run 1
grep -q 'Checksum tidak cocok' "$T/out" || fail "checksum message"
[ ! -e "$HOME/panel-src/$BAD" ] || fail "corrupt release extracted"
if grep -q '^install-phone' "$CALLS"; then fail "install-phone.sh ran after a checksum failure"; fi
[ -z "$(ls "$TMPDIR")" ] || fail "temp dir not cleaned after failure"

# 8. Version that was never released.
PANEL_VERSION=v0.0.404
run 1
unset PANEL_VERSION
grep -q 'Belum ada rilis' "$T/out" || fail "404 message"

echo "install-release.test.sh: all checks passed"
