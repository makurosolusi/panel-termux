// Fake HOME of a demo data dir (<data dir>/fake-home, read by boot in fake mode): site folders, apps.json, tunnel
// config, device/database scenario and the fake S3 bucket, so every demo page agrees with the database rows.
import { mkdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { panelAppEntry, runScriptText } from "../src/server/deploy/run.script";
import { FAKE_S3_DIR } from "../src/server/system/external.fake";
import type { FakeIntegration } from "../src/server/system/fake.integration";
import { FAKE_HOME_DIR, FAKE_SCENARIO_FILE, FAKE_TUNNEL_ID } from "../src/server/system/system.fake";
import type { DatabaseInfo } from "../src/shared/panel.types";

/** Fictional S3 bucket of the demo (settings + fake bucket folder). */
export const DEMO_BUCKET = "cadangan-demo";
/** Demo battery: 22 %, not charging → one active `battery_low` warning (PLAN/02 §6). */
export const DEMO_BATTERY = { percent: 22, charging: false, status: "discharging", plugged: "unplugged" } as const;
/** Databases the fake postgres lists: the fake's own, the site's, and the test restores still present. */
export const DEMO_DATABASES: DatabaseInfo[] = [
  { name: "adminneo", owner: "postgres", sizeBytes: 8_000_000 },
  { name: "solusi", owner: "solusi", sizeBytes: 24_500_000 },
  { name: "toko_kopi", owner: "toko_kopi", sizeBytes: 31_200_000 },
  { name: "toko_kopi_uji_2", owner: "toko_kopi", sizeBytes: 30_900_000 },
  { name: "toko_kopi_uji_3", owner: "toko_kopi", sizeBytes: 1_100_000 },
];
/** Live and previous binary size of toko-kopi (sparse files, so the demo dir stays small). */
export const DEMO_BINARY_BYTES = 18_400_000;
const PREV_BINARY_BYTES = 18_250_000;
const ELF_HEADER_BYTES = 64;

// Ingress of the demo phone: the 3 sites, adminneo (php, not adoptable), demo-api (adoptable: binary, no site),
// old.contoh.test → kasir-lama (errored), so its failing domain is held behind the app problem.
const CONFIG_YML = `tunnel: ${FAKE_TUNNEL_ID}
credentials-file: /fake/.cloudflared/${FAKE_TUNNEL_ID}.json

ingress:
  - hostname: toko-kopi.contoh.com
    service: http://localhost:3010
  - hostname: blog.contoh.com
    service: http://localhost:3011
  - hostname: blog.contoh.test
    service: http://localhost:3011
  - hostname: solusi.contoh.test
    service: http://localhost:3005
  - hostname: db.contoh.test
    service: http://localhost:3006
  - hostname: api.contoh.test
    service: http://localhost:3007
  - hostname: old.contoh.test
    service: http://localhost:3008
  - service: http_status:404
`;
/** Hostnames of CONFIG_YML (the seeded domain checks cover all of them). */
export const DEMO_HOSTS = [...CONFIG_YML.matchAll(/hostname: (\S+)/g)].map((m) => m[1] as string);

/** A static aarch64 ELF header (runtime "native"), zero-padded to `size` bytes. */
function writeElf(path: string, size: number): void {
  const b = Buffer.alloc(ELF_HEADER_BYTES);
  b.writeUInt32BE(0x7f454c46, 0); // \x7fELF
  b[4] = 2; // 64-bit
  b[5] = 1; // little endian
  b[6] = 1; // ELF version
  b.writeUInt16LE(2, 16); // ET_EXEC
  b.writeUInt16LE(183, 18); // EM_AARCH64
  b.writeUInt32LE(1, 20);
  b.writeUInt16LE(ELF_HEADER_BYTES, 52);
  b.writeUInt16LE(56, 54); // program header size, 0 headers = statically linked
  writeFileSync(path, b, { mode: 0o755 });
  truncateSync(path, size);
}

/** Paths inside the demo fake HOME. */
export const demoHome = (dataDir: string) => {
  const home = join(dataDir, FAKE_HOME_DIR);
  return { home, sites: join(home, "sites"), site: (name: string) => join(home, "sites", name) };
};

/**
 * Wipes and rewrites the fake HOME (site files, apps.json, config.yml, scenario incl. the Persiapan `integration`
 * the fake writes ecosystem.config.js + pm2 run script for on first start); returns the live binary path.
 */
export function writeDemoHome(
  dataDir: string,
  ports: Record<string, number>,
  integration: FakeIntegration = "ready",
): { liveBinary: string } {
  const h = demoHome(dataDir);
  rmSync(h.home, { recursive: true, force: true });
  for (const [name, port] of Object.entries(ports)) {
    mkdirSync(h.site(name), { recursive: true });
    writeFileSync(join(h.site(name), ".env"), `PORT=${port}\nTZ=Asia/Jakarta\n`, { mode: 0o600 });
  }
  // toko-kopi: deployed twice (live + previous, so rollback works), started by pm2 from apps.json.
  const toko = h.site("toko-kopi");
  writeElf(join(toko, "app"), DEMO_BINARY_BYTES);
  writeElf(join(toko, "app.prev"), PREV_BINARY_BYTES);
  // demo-api: a binary under ~/sites run by a hand-written pm2 entry, no site yet → adoption candidate.
  for (const dir of [toko, h.site("demo-api")])
    writeFileSync(join(dir, "run"), runScriptText("native"), { mode: 0o755 });
  writeElf(join(h.site("demo-api"), "app"), DEMO_BINARY_BYTES);
  writeFileSync(join(h.sites, "apps.json"), `${JSON.stringify([panelAppEntry("toko-kopi", toko)], null, 2)}\n`);
  mkdirSync(join(h.home, ".cloudflared"), { recursive: true });
  writeFileSync(join(h.home, ".cloudflared", "config.yml"), CONFIG_YML);
  const scenario = { battery: DEMO_BATTERY, databases: DEMO_DATABASES, integration };
  writeFileSync(join(h.home, FAKE_SCENARIO_FILE), `${JSON.stringify(scenario, null, 2)}\n`);
  return { liveBinary: join(toko, "app") };
}

/** Puts `body` at `key` in the demo's fake S3 bucket (what the offline S3 client reads). */
export function writeDemoObject(dataDir: string, key: string, body: string): void {
  const file = join(demoHome(dataDir).home, FAKE_S3_DIR, DEMO_BUCKET, key);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}
