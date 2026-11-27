#!/bin/sh
# Stub test of install-release.sh (published as install.sh, the 0.5.x shim): fake uname/curl on PATH, a real release
# built by package-release.sh around a stub `panel` that records `init "$@"` and exits with a chosen code.
# Runs without a TTY on stdin. Run: sh scripts/install-release.test.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" PREFIX="$T/usr" TMPDIR="$T/tmp"
mkdir -p "$HOME" "$PREFIX" "$TMPDIR" "$T/bin" "$T/rel"
CALLS="$T/calls"
: >"$CALLS"
TAG=v9.9.9-test
export PANEL_RELEASES_URL=https://releases.example.test/download

# PATH is cut down to $T/bin + system dirs below; keep sha256sum reachable.
if command -v sha256sum >/dev/null 2>&1; then
  ln -s "$(command -v sha256sum)" "$T/bin/sha256sum"
else
  printf '#!/bin/sh\nexec shasum -a 256 "$@"\n' >"$T/bin/sha256sum"
  chmod 755 "$T/bin/sha256sum"
fi
echo aarch64 >"$T/arch"
printf '#!/bin/sh\ncat "%s"\n' "$T/arch" >"$T/bin/uname"
# curl -fsSL --retry 3 -o <file> <url>: serves $T/rel/<version>/<asset>, else fails like -f on a 404 (exit 22).
cat >"$T/bin/curl" <<EOF
#!/bin/sh
out=""
while [ \$# -gt 1 ]; do
  [ "\$1" = -o ] && { out=\$2; shift; }
  shift
done
echo "curl \$1" >>"$CALLS"
src="$T/rel/\${1#$PANEL_RELEASES_URL/}"
[ -f "\$src" ] || exit 22
cp "\$src" "\$out"
EOF
chmod 755 "$T/bin/uname" "$T/bin/curl"
PATH="$T/bin:/usr/bin:/bin"

# The stub binary: records its arguments and file mode, exits with $T/init_rc (default 0).
cat >"$T/panel-stub" <<EOF
#!/bin/sh
echo "panel \$* mode=\$(ls -l "\$0" | cut -c1-10)" >>"$CALLS"
exit \$(cat "$T/init_rc" 2>/dev/null || echo 0)
EOF
sh "$HERE/package-release.sh" "$T/panel-stub" "$T/rel/$TAG" "$TAG" >/dev/null
INSTALL="$T/rel/$TAG/install.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
run() {
  want=$1
  shift
  rc=0
  sh "$INSTALL" "$@" </dev/null >"$T/out" 2>&1 || rc=$?
  [ "$rc" -eq "$want" ] || { cat "$T/out"; fail "install.sh exited $rc, want $want"; }
}
downloads() { grep -c '^curl ' "$CALLS" || true; }
inits() { grep -c '^panel ' "$CALLS" || true; }

# 1. Not arm64: refuse before downloading anything.
echo x86_64 >"$T/arch"
run 1
grep -q 'needs a 64-bit Android phone (arm64)' "$T/out" || fail "arch message"
[ "$(downloads)" = 0 ] || fail "downloaded on a non-arm64 phone"
echo aarch64 >"$T/arch"

# 2. Not in Termux ($PREFIX missing).
# (assignments before a function call persist in some shells, so set and restore explicitly)
PREFIX="$T/nope"
run 1
PREFIX="$T/usr"
grep -q 'run this script in Termux' "$T/out" || fail "Termux message"

# 3. Baked-in version: downloads only SHA256SUMS + panel, checks, execs `panel init <args>` with mode 755.
run 0 --yes
grep -q "^curl $PANEL_RELEASES_URL/$TAG/SHA256SUMS\$" "$CALLS" || fail "SHA256SUMS not downloaded"
grep -q "^curl $PANEL_RELEASES_URL/$TAG/panel\$" "$CALLS" || fail "panel not downloaded"
[ "$(downloads)" = 2 ] || fail "downloaded more than SHA256SUMS + panel"
grep -q '^panel init --yes mode=-rwxr-xr-x$' "$CALLS" || fail "panel init not exec'd: $(cat "$CALLS")"

# 4. Exit code of `panel init` is the exit code of install.sh.
for code in 1 3; do
  echo "$code" >"$T/init_rc"
  run "$code"
done
rm "$T/init_rc"

# 5. Corrupt binary: checksum fails, exit 1, panel never runs, temp dir removed.
BAD=v9.9.8-test
mkdir "$T/rel/$BAD"
cp "$T/rel/$TAG/SHA256SUMS" "$T/rel/$BAD/"
{ cat "$T/rel/$TAG/panel"; echo x; } >"$T/rel/$BAD/panel"
rm -rf "$TMPDIR"/*
: >"$CALLS"
export PANEL_VERSION=$BAD
run 1
grep -q 'Checksum mismatch' "$T/out" || fail "checksum message"
[ "$(inits)" = 0 ] || fail "panel ran after a checksum failure"
[ -z "$(ls "$TMPDIR")" ] || fail "temp dir not cleaned after failure"

# 6. Version that was never released: download error, panel never runs.
: >"$CALLS"
PANEL_VERSION=v0.0.404
run 1
unset PANEL_VERSION
grep -q 'Downloading SHA256SUMS v0.0.404 failed' "$T/out" || fail "download-failure message"
[ "$(inits)" = 0 ] || fail "panel ran without a download"

echo "install-release.test.sh: all checks passed"
