// Compiles the panel (server + embedded SPA) into one executable.
// Usage: bun scripts/build.ts <bun-compile-target|local> <outfile>
import tailwind from "bun-plugin-tailwind";

const [target, outfile] = process.argv.slice(2);
if (!target || !outfile) {
  console.error("usage: bun scripts/build.ts <bun-linux-arm64-android|local> <outfile>");
  process.exit(2);
}

// The runtime embedded is the one of the bun running this script. Under `bun run` that is node_modules/.bin/bun
// (bun@ from bun.lock, a peer of bun-plugin-tailwind), not the bun on PATH. Pinning `-v<Bun.version>` keeps a
// cross target from ever resolving to another version; "local" embeds the running executable itself.
// PLAN/07 K19, C24: the release tag is embedded here, at build time only (release.yml sets PANEL_RELEASE_TAG); the
// binary never reads it from its own environment. Unset = local/dev build ("", self check skipped with a note).
const releaseTag = process.env.PANEL_RELEASE_TAG ?? "";
if (releaseTag && !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(releaseTag)) {
  console.error(`build: PANEL_RELEASE_TAG="${releaseTag}" is not a release tag (want v<x.y.z>[-<pre>])`);
  process.exit(2);
}

const compileTarget = target === "local" ? undefined : (`${target}-v${Bun.version}` as Bun.Build.CompileTarget);

const result = await Bun.build({
  // PLAN/07 K1: thin entry; CLI commands load lazily and never evaluate the server bundle (lab L5)
  entrypoints: ["./src/server/main.ts"],
  compile: {
    ...(compileTarget ? { target: compileTarget } : {}),
    outfile,
    autoloadBunfig: false,
  },
  minify: true,
  // PLAN/01 §3.11: the SPA splits into entry (landing + session), `login` and `app` chunks
  splitting: true,
  plugins: [tailwind],
  loader: { ".sql": "text" },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __PANEL_RELEASE_TAG__: JSON.stringify(releaseTag),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// Every runtime carries `Bun v<version> (<revision>)`; refuse a binary whose runtime is not the one asked for.
const marker = `Bun v${Bun.version} (`;
if (!Buffer.from(await Bun.file(outfile).arrayBuffer()).includes(marker)) {
  console.error(`build ${outfile}: embedded runtime is not bun ${Bun.version} ("${marker}" not found)`);
  process.exit(1);
}
console.info(`built ${outfile} (${target}, bun ${Bun.version}, tag ${releaseTag || "none: local build"})`);
