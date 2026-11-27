// Fictional demo data + signed sessions for QA/screenshots (PLAN/05 W3). Prints counts only, never cookies or keys.
// Usage: bun scripts/demo-seed.ts --data-dir <dir> --base-url <url> [--integration poco]; then run the panel on that
// dir in fake mode with APP_BASE_URL=<url>. `--integration` picks the Persiapan scenario (fake.integration.ts).
// Give each parallel instance its own host, e.g. http://demo1.localhost:3421: browser cookies are per host, not per
// port, so two instances on localhost would sign each other out.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import pkg from "../package.json" with { type: "json" };
import { createAuth } from "../src/server/auth/auth.service";
import { openDb } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import * as t from "../src/server/db/schema";
import { loadOrCreateSecret } from "../src/server/secret";
import { setSettings } from "../src/server/settings.service";
import { FAKE_INTEGRATIONS, type FakeIntegration } from "../src/server/system/fake.integration";
import type { Role } from "../src/shared/roles";
import type { JobStep } from "../src/shared/site.types";
import { seedBackups, seedMonitor, type Tx } from "./demo-seed.history";
import { DEMO_BINARY_BYTES, DEMO_BUCKET, demoHome, writeDemoHome } from "./demo-seed.sandbox";

/** Must be in the panel's SUPER_ADMIN_EMAILS, or boot demotes the demo super admin. */
export const DEMO_SUPER_ADMIN_EMAIL = "demo@contoh.test";
/** app_meta key marking a demo-only data dir (required to reseed). */
export const DEMO_MARKER = "demo_seed";
/** Cookie file written into the data dir (mode 600). */
export const COOKIE_FILE = "demo-cookies.json";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SHA = (c: string) => c.repeat(64);
/** Tables the seed owns: wiped on rerun (children first) and counted in the result. */
const TABLES = (
  "session account deploy job site_hostname site backup_restore backup_run audit_log problem_event metric_sample " +
  "check_result setting dns_record user"
).split(" ");

/** Demo accounts; the first three (one per signed-in role) get sessions and cookies. */
const USERS: { id: string; email: string; name: string; role: Role }[] = [
  { id: "demo-super", email: DEMO_SUPER_ADMIN_EMAIL, name: "Dewi Pratama", role: "super_admin" },
  { id: "demo-admin", email: "admin@contoh.test", name: "Budi Santoso", role: "admin" },
  { id: "demo-user", email: "pengguna@contoh.test", name: "Rina Wulandari", role: "user" },
  { id: "demo-admin2", email: "operator@contoh.com", name: "Agus Hidayat", role: "admin" },
  { id: "demo-user2", email: "tamu@contoh.com", name: "Sari Lestari", role: "user" },
];

/** Throws unless `dataDir` is safe to (re)seed: not ~/panel, not ./data, not a non-demo panel.db with users. */
export function assertDemoDir(dataDir: string): void {
  const dir = resolve(dataDir);
  const under = (base: string) => dir === base || dir.startsWith(base + sep);
  for (const base of [join(homedir(), "panel"), resolve("data"), resolve(import.meta.dir, "..", "data")])
    if (under(base)) throw new Error(`demo-seed: refusing ${dir}: inside ${base} (production/dev data)`);
  const file = join(dir, "panel.db");
  if (!existsSync(file)) return;
  const db = new Database(file, { readonly: true });
  try {
    const has = (name: string) => db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const marked = has("app_meta") && db.query("SELECT 1 FROM app_meta WHERE key=?").get(DEMO_MARKER);
    const users = has("user") ? (db.query("SELECT count(*) AS n FROM user").get() as { n: number }).n : 0;
    if (!marked && users > 0) throw new Error(`demo-seed: refusing ${file}: has ${users} user(s) and no demo marker`);
  } finally {
    db.close();
  }
}

/** Better Auth session cookie: token + HMAC-SHA256(secret) signature (as tests/auth.test.ts). */
async function signedCookie(token: string, secret: string, baseUrl: string): Promise<string> {
  const enc = new TextEncoder();
  const alg = { name: "HMAC", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), alg, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(token)))));
  const name = `${baseUrl.startsWith("https:") ? "__Secure-" : ""}better-auth.session_token`;
  return `${name}=${encodeURIComponent(`${token}.${sig}`)}`;
}

type P = JobStep["params"];
type S = JobStep["status"];
const step = (key: string, status: S, code: string | null, params: P = {}): JobStep => ({ key, status, code, params });
const ok = (key: string, code: string, params: P = {}) => step(key, "done", code, params);
const err = (code: string, params: P = {}) => JSON.stringify({ code, params, detail: null });

/** Site name → [port, database, runtime, managed, hosts]; makuro-solusi = the fake pm2 app + ingress, adopted. */
const SITES = {
  "toko-kopi": [3010, "toko_kopi", "native", true, ["toko-kopi.contoh.com"]],
  blog: [3011, null, "grun", true, ["blog.contoh.com", "blog.contoh.test"]],
  "makuro-solusi": [3005, null, "grun", false, ["solusi.contoh.test"]],
} as const;

/** Users, 3 sites (one adopted), 7 jobs in every end state and 4 deploys (newest one live). */
function seedSites(tx: Tx, dataDir: string, liveBinary: string, ago: (h: number) => Date): void {
  tx.insert(t.user)
    .values(USERS.map((u, i) => ({ ...u, emailVerified: true, createdAt: ago(170 - i * 20) })))
    .run();
  for (const [i, [name, [port, database, runtime, managed, hosts]]] of Object.entries(SITES).entries()) {
    const dir = demoHome(dataDir).site(name);
    const app = managed ? null : name;
    tx.insert(t.site)
      .values({ name, port, app, database, runtime, managed, dir, createdAt: ago(160 - i * 10) })
      .run();
    for (const hostname of hosts)
      tx.insert(t.siteHostname)
        .values({ hostname, siteName: name, ingressManaged: managed, dnsManaged: managed })
        .run();
  }
  // Live binary of toko-kopi: its newest deploy shows as active (stat identity match).
  const bin = statSync(liveBinary);

  const create = (site: keyof typeof SITES) => {
    const hostnames = SITES[site][4].join(", ");
    return [
      ok("validate", "validated"),
      ok("folder", "folder_created", { path: `~/sites/${site}` }),
      ok("env_write", "env_written", { count: 2 }),
      ok("ingress", "ingress_added", { hostnames }),
      ok("dns", "dns_created", { hostnames }),
      ok("tunnel_restart", "tunnel_restarted", { seconds: 4 }),
      ok("domain_probe", "domain_reachable", { hostname: SITES[site][4][0], status: 200 }),
    ];
  };
  const head = (runtime: string) => [
    ok("stage", "staged", { sizeBytes: DEMO_BINARY_BYTES }),
    ok("detect", `runtime_${runtime}`),
    ok("chmod", "chmod_done"),
  ];
  const tail = [
    ok("run_script", "run_written", { runtime: "native" }),
    ok("apps_entry", "apps_unchanged"),
    ok("app_restart", "app_restarted", { name: "toko-kopi" }),
  ];
  const deployOk = [
    ...head("native"),
    ok("swap", "swap_kept_previous"),
    ...tail,
    ok("health", "healthy", { status: 200, path: "/", ms: 840 }),
  ];
  const timeout = { seconds: 60, last: 502, path: "/" };
  const dnsConflict = { hostname: "blog.contoh.test" };
  // [id, kind, target, status, steps, error, actor, hours ago]
  const jobs = [
    ["job-demo-01", "site.create", "toko-kopi", "succeeded", create("toko-kopi"), null, "demo-super", 150],
    ["job-demo-02", "site.create", "blog", "succeeded", create("blog"), null, "demo-admin", 140],
    ["job-demo-03", "site.deploy", "toko-kopi", "succeeded", deployOk, null, "demo-admin", 96],
    [
      "job-demo-04",
      "site.deploy",
      "toko-kopi",
      "rolled_back",
      [
        ...head("native"),
        step("swap", "rolled_back", "swap_back"),
        ...tail,
        step("health", "failed", "health_timeout", timeout),
      ],
      err("health_timeout", timeout),
      "demo-admin",
      48,
    ],
    ["job-demo-05", "site.deploy", "toko-kopi", "succeeded", deployOk, null, "demo-super", 20],
    [
      "job-demo-06",
      "site.deploy",
      "blog",
      "interrupted",
      [
        ...head("grun"),
        step("swap", "running", "interrupted"),
        ...["run_script", "apps_entry", "app_restart", "health"].map((k) => step(k, "pending", null)),
      ],
      err("interrupted"),
      "demo-admin",
      6,
    ],
    [
      "job-demo-07",
      "hostname.add",
      "blog",
      "failed",
      [
        ok("validate", "validated"),
        ok("ingress", "ingress_added", { hostnames: dnsConflict.hostname }),
        step("dns", "failed", "dns_conflict", dnsConflict),
      ],
      err("dns_conflict", dnsConflict),
      "demo-admin",
      3,
    ],
  ] as const;
  for (const [id, kind, target, status, steps, error, actorId, h] of jobs) {
    const finishedAt = new Date(ago(h).getTime() + 95_000);
    tx.insert(t.job)
      .values({
        id,
        kind,
        target,
        status,
        steps: [...steps],
        error,
        actorId,
        startedAt: ago(h),
        finishedAt,
        input: { name: target },
      })
      .run();
    if (kind !== "site.deploy") continue;
    const live = id === "job-demo-05";
    const runtime = target === "blog" ? "grun" : "native";
    tx.insert(t.deploy)
      .values({
        id: id.replace("job", "dep"),
        siteName: target,
        kind: "deploy",
        status,
        sha256: SHA(id.slice(-1)),
        jobId: id,
        sizeBytes: live ? bin.size : 18_400_000 + h * 1000,
        runtime,
        actorId,
        at: ago(h),
        finishedAt,
        fileName: `${target}-${id.slice(-2)}`,
        binIno: live ? bin.ino : null,
        binMtimeMs: live ? Math.trunc(bin.mtimeMs) : null,
      })
      .run();
  }
}

/** 20 audit entries over the week across many actions (sign-ins come from the session hook). */
function seedAudit(tx: Tx, ago: (h: number) => Date): void {
  const audits: [string, string, string | null, Record<string, unknown> | null][] = [
    ["demo-super", "site.create", "toko-kopi", { port: 3010 }],
    ["demo-admin", "site.create", "blog", { port: 3011 }],
    ["demo-super", "site.adopt", "makuro-solusi", { app: "makuro-solusi" }],
    ["demo-super", "user.role_change", "demo-admin", { from: "user", to: "admin", targetEmail: "admin@contoh.test" }],
    ["demo-super", "settings.update", null, { keys: ["backup.s3_bucket"] }],
    ["demo-admin", "site.deploy", "toko-kopi", { jobId: "job-demo-03" }],
    ["demo-admin", "site.env_update", "toko-kopi", { keys: ["TZ"] }],
    ["demo-admin", "service.restart", "cloudflared", null],
    ["demo-super", "backup.run", null, { trigger: "manual" }],
    ["demo-super", "backup.restore", "bk-demo-2", { targetDb: "toko_kopi_uji_1" }],
    ["demo-super", "backup.restore_drop", "toko_kopi_uji_1", null],
    ["demo-admin", "site.deploy", "toko-kopi", { jobId: "job-demo-04" }],
    ["demo-admin", "site.rollback", "toko-kopi", null],
    ["demo-admin", "hostname.add", "blog", { hostname: "blog.contoh.test" }],
    ["demo-super", "dns.create", "toko-kopi.contoh.com", null],
    ["demo-admin", "site.restart", "blog", null],
    // meta as revokeUserSessions writes it, so the sentence names the user and the count (QA m3)
    [
      "demo-super",
      "session.revoke",
      "demo-user2",
      { scope: "user", userId: "demo-user2", revoked: 2, targetEmail: "tamu@contoh.com" },
    ],
    ["demo-super", "audit.export", null, { rows: 120 }],
    ["demo-admin", "log.download", "app:makuro-solusi:out", null],
    ["demo-super", "site.settings_update", "blog", { healthPath: "/health" }],
  ];
  const byId = new Map(USERS.map((u) => [u.id, u]));
  const rows = audits.map(([actorId, action, target, meta], i) => ({
    at: ago(160 - i * 7),
    actorId,
    actorKind: "user" as const,
    action,
    target,
    meta,
    actorLabel: byId.get(actorId)?.name ?? null,
    actorEmail: byId.get(actorId)?.email ?? null,
    ipMasked: "203.0.113.x",
    userAgent: "Chrome di Android", // shortUserAgent's format (QA N3)
  }));
  tx.insert(t.auditLog).values(rows).run();
}

/** Ports of the site folders in the fake HOME: the 3 sites + demo-api (adoption candidate). */
const PORTS = { ...Object.fromEntries(Object.entries(SITES).map(([n, v]) => [n, v[0]])), "demo-api": 3007 };

/** `--integration` values the demo supports: every fake scenario except `no_sites_dir` (demo sites need folders). */
export const DEMO_INTEGRATIONS: readonly FakeIntegration[] = FAKE_INTEGRATIONS.filter((i) => i !== "no_sites_dir");

/**
 * Seeds `dataDir` (migrations, demo rows, fake HOME, sessions), writes the cookie file; returns row counts.
 * `integration` = Persiapan scenario of the fake HOME (default `ready`).
 */
export async function seedDemo(opts: {
  dataDir: string;
  baseUrl: string;
  integration?: FakeIntegration;
}): Promise<Record<string, number>> {
  const dataDir = resolve(opts.dataDir);
  assertDemoDir(dataDir);
  new URL(opts.baseUrl); // throws on an invalid --base-url before anything is written
  const integration = opts.integration ?? "ready";
  if (!DEMO_INTEGRATIONS.includes(integration))
    throw new Error(`demo-seed: --integration must be one of ${DEMO_INTEGRATIONS.join(", ")} (got ${integration})`);
  const { secret } = loadOrCreateSecret(dataDir);
  const db = openDb(dataDir);
  try {
    runMigrations(db);
    // Whole minutes: no seed time lands on odd seconds (times are shown without seconds).
    const now = Math.floor(Date.now() / MINUTE) * MINUTE;
    const { liveBinary } = writeDemoHome(dataDir, PORTS, integration);
    const ago = (h: number) => new Date(now - h * HOUR);
    db.transaction((tx) => {
      // Rerun = wipe and rewrite: fresh timestamps and sessions.
      for (const name of TABLES) tx.run(sql.raw(`DELETE FROM "${name}"`));
      const meta = [
        { key: DEMO_MARKER, value: "1" },
        { key: "panel_version", value: pkg.version },
      ];
      tx.insert(t.appMeta)
        .values(meta)
        .onConflictDoUpdate({ target: t.appMeta.key, set: { value: sql`excluded.value` } })
        .run();
      seedSites(tx, dataDir, liveBinary, ago);
      seedBackups(tx, dataDir, ago);
      seedAudit(tx, ago);
      seedMonitor(tx, now);
    });
    // Fictional S3 target; in fake mode the panel uses the offline bucket under fake-home, so runs succeed.
    const demoSettings = {
      "backup.s3_endpoint": "https://s3.contoh.test",
      "backup.s3_bucket": DEMO_BUCKET,
      // Fictional token: the setup card is complete; fake mode answers Cloudflare calls offline.
      "cloudflare.api_token": "demo_token_bukan_asli_0001",
      "backup.s3_access_key_id": "DEMOKEYID0001",
      "backup.s3_secret_access_key": "DEMOSECRETKEY0001",
    };
    setSettings({ db, secret }, demoSettings, "demo-super");

    const env = { APP_BASE_URL: opts.baseUrl, GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x" };
    const ctx = await createAuth({ db, secret, env: { ...env, SUPER_ADMIN_EMAILS: [DEMO_SUPER_ADMIN_EMAIL] } })
      .$context;
    const cookies: Record<string, string> = {};
    for (const u of USERS.slice(0, 3)) {
      const s = await ctx.internalAdapter.createSession(u.id);
      if (!s) throw new Error(`demo-seed: createSession for ${u.id} returned null`);
      cookies[u.role] = await signedCookie(s.token, secret, opts.baseUrl);
    }
    const cookieFile = join(dataDir, COOKIE_FILE);
    writeFileSync(cookieFile, `${JSON.stringify(cookies, null, 2)}\n`, { mode: 0o600 });
    chmodSync(cookieFile, 0o600); // writeFileSync keeps the old mode of an existing file
    const count = (name: string) => (db.$client.query(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n;
    return Object.fromEntries(TABLES.map((n) => [n, count(n)]));
  } finally {
    db.$client.close();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { "data-dir": { type: "string" }, "base-url": { type: "string" }, integration: { type: "string" } },
  });
  const dataDir = values["data-dir"];
  const baseUrl = values["base-url"];
  if (!dataDir || !baseUrl) {
    console.error("usage: bun scripts/demo-seed.ts --data-dir <dir> --base-url <url> [--integration <scenario>]");
    process.exit(2);
  }
  try {
    const integration = values.integration as FakeIntegration | undefined; // validated by seedDemo
    console.log(`demo-seed: ${JSON.stringify(await seedDemo({ dataDir, baseUrl, integration }))}`);
    console.log(`demo-seed: cookies (mode 600) in ${join(resolve(dataDir), COOKIE_FILE)}`);
    console.log(
      `demo-seed: start the panel (fake mode) with PANEL_DATA_DIR=${resolve(dataDir)} APP_BASE_URL=${baseUrl} ` +
        `SUPER_ADMIN_EMAILS=${DEMO_SUPER_ADMIN_EMAIL}`,
    );
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
