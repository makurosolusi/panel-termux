// Sandbox ecosystem.config.js + pm2 run script per fake integration scenario (PLAN/06 §8), so QA can exercise every
// Persiapan fix in fake mode. All file texts here are test-only fixtures shaped like real phones.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error TS2307: Bun embeds the shipped runit script as text; tsc cannot resolve an extensionless module.
import PM2_RUN_TEMPLATE from "../../../deploy/pm2/run" with { type: "text" };
import { BLOCK_VERSION, ecosystemBlock } from "../sites/ecosystem.patch";
import { ecosystemFromTemplate } from "../sites/ecosystem.template";

/**
 * Persiapan state of the sandbox: `ready` = shipped template + run script (all checks pass); `poco` = POCO's
 * hand-written ecosystem (2 apps, no panel block) + run script without `--no-auto-exit`; `old_spread` = 0.2.x
 * `...require('./apps.json')`; `exotic` = POCO file with a Latin-1 byte (not UTF-8, panel refuses); `broken` =
 * ecosystem that does not load; `no_sites_dir` = no sites folder at all; `block_v1` = POCO file carrying the 0.3.x
 * v1 panel block (Indonesian comments), which the fix replaces with the current block.
 */
export type FakeIntegration = "ready" | "poco" | "old_spread" | "exotic" | "broken" | "no_sites_dir" | "block_v1";
/** Every scenario name (demo-seed `--integration` validation). */
export const FAKE_INTEGRATIONS: readonly FakeIntegration[] = [
  "ready",
  "poco",
  "old_spread",
  "exotic",
  "broken",
  "no_sites_dir",
  "block_v1",
];

/**
 * The shipped deploy/pm2/ecosystem.config.js with its Termux paths pointed into the sandbox (so the Persiapan card
 * passes in fake mode). `$PREFIX` becomes `<home>/usr`, where the sandbox puts the guard's `sleep`.
 */
export const fakeEcosystem = (home: string): string => ecosystemFromTemplate(join(home, "sites"), join(home, "usr"));

/** POCO's ecosystem (R&D/07 §1) with sandbox paths; `extra` lands in the apps array after the two hand apps. */
const pocoEcosystem = (home: string, extra = "", comment = "Admin DB: sengaja hanya 127.0.0.1, tanpa domain") =>
  `const SITES = ${JSON.stringify(join(home, "sites"))}
const site = (name) => ({ name, cwd: \`\${SITES}/\${name}\`, script: ${JSON.stringify(join(home, "usr", "bin", "grun"))}, args: './app', interpreter: 'none', exp_backoff_restart_delay: 1000 })
module.exports = {
  apps: [
    site('makuro-solusi'),
    // ${comment}
    { name: 'adminneo', cwd: \`\${SITES}/adminneo\`, script: ${JSON.stringify(join(home, "usr", "bin", "php"))}, args: '-S 127.0.0.1:3006 index.php', interpreter: 'none', exp_backoff_restart_delay: 1000 },${extra}
  ],
}
`;

/** POCO's hand-written run script: same job as deploy/pm2/run, Indonesian comments, no `--no-auto-exit`. */
const POCO_RUN = `#!/data/data/com.termux/files/usr/bin/sh
# Layanan pm2: runit menjaga pm2-runtime tetap hidup.
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:$PATH
export PM2_HOME=$HOME/.pm2
exec node /data/data/com.termux/files/usr/lib/node_modules/pm2/bin/pm2-runtime $HOME/sites/ecosystem.config.js 2>&1
`;

/** Comment lines of the 0.3.x v1 block (test-only fixture text); the code lines are the same as the current block. */
const V1_COMMENTS = [
  "// >>> panel-termux:apps v1 (dikelola Panel Termux; panel mengganti blok ini utuh, jangan diedit)",
  "// Menambahkan situs buatan panel dari apps.json ke daftar apps di atas. Entri yang binary-nya belum ada dilewati,",
  "// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi. Bila tidak ada aplikasi tulisan",
  "// tangan, penjaga pm2-guard ditambahkan agar pm2-runtime tidak keluar. Blok ini tidak pernah menggagalkan file.",
];
/** The v1 block as 0.3.x wrote it, for `prefix`. */
const blockV1 = (prefix: string) => {
  const lines = ecosystemBlock(prefix).split("\n");
  lines.splice(0, V1_COMMENTS.length, ...V1_COMMENTS);
  return lines.join("\n").replace(`{ v: ${BLOCK_VERSION}, listed`, "{ v: 1, listed");
};

/** Ecosystem bytes of a scenario (null = no file: `no_sites_dir`). */
function ecosystemOf(home: string, scenario: FakeIntegration): string | Buffer | null {
  switch (scenario) {
    case "ready":
      return fakeEcosystem(home);
    case "poco":
      return pocoEcosystem(home);
    case "old_spread":
      return pocoEcosystem(home, "\n    ...require('./apps.json'),");
    case "exotic":
      // "é" as the single Latin-1 byte 0xE9: node still loads it, but the panel must not rewrite it.
      return Buffer.from(pocoEcosystem(home, "", "Admin DB: akses lokal saja (café)"), "latin1");
    case "broken":
      return pocoEcosystem(home).replace("module.exports = {", "module.exports = {{");
    case "no_sites_dir":
      return null;
    case "block_v1":
      return `${pocoEcosystem(home)}\n${blockV1(join(home, "usr"))}`;
  }
}

/** Stand-ins for the Termux binaries the ecosystems name (only existence is checked; `sleep` is really run). */
const FAKE_TOOLS = {
  grun: '#!/bin/sh\nexec "$@"\n',
  php: "#!/bin/sh\nexit 0\n",
  sleep: '#!/bin/sh\nexec sleep "$@"\n',
};

const writeExec = (path: string, text: string) => {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
};

/**
 * Writes the scenario's files into the sandbox `home` when absent (kept across restarts): `<home>/sites`
 * (except `no_sites_dir`) with `ecosystem.config.js` (+ `apps.json` = `[]` except `ready`),
 * `<home>/usr/var/service/pm2/run` (mode 755), fake `grun`/`php`/`sleep` in `<home>/usr/bin`, and for `poco` a
 * placeholder `~/.cloudflared/cert.pem` (only its existence is ever checked).
 */
export function writeFakeIntegration(home: string, scenario: FakeIntegration): void {
  const sitesDir = join(home, "sites");
  const binDir = join(home, "usr", "bin");
  const pm2Sv = join(home, "usr", "var", "service", "pm2");
  for (const d of [binDir, pm2Sv]) mkdirSync(d, { recursive: true });
  const run = join(pm2Sv, "run");
  if (!existsSync(run))
    writeExec(run, scenario === "ready" || scenario === "no_sites_dir" ? PM2_RUN_TEMPLATE : POCO_RUN);
  for (const [tool, body] of Object.entries(FAKE_TOOLS)) {
    const file = join(binDir, tool);
    if (!existsSync(file)) writeExec(file, body);
  }
  if (scenario === "poco") {
    const cert = join(home, ".cloudflared", "cert.pem");
    mkdirSync(join(home, ".cloudflared"), { recursive: true });
    if (!existsSync(cert)) writeFileSync(cert, "fake cert.pem (test-only, not a certificate)\n", { mode: 0o600 });
  }
  const eco = ecosystemOf(home, scenario);
  if (eco === null) return;
  mkdirSync(sitesDir, { recursive: true });
  const file = join(sitesDir, "ecosystem.config.js");
  if (!existsSync(file)) writeFileSync(file, eco, { mode: scenario === "ready" ? 0o644 : 0o600 });
  // A phone that already ran the panel has apps.json (POCO: `[]`); `ready` keeps the fresh-install state without it.
  const appsJson = join(sitesDir, "apps.json");
  if (scenario !== "ready" && !existsSync(appsJson)) writeFileSync(appsJson, "[]\n");
}
