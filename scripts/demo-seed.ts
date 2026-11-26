// Fictional demo data + signed sessions for QA/screenshots (PLAN/05 W3). Prints counts only, never cookies or keys.
// Usage: bun scripts/demo-seed.ts --data-dir <dir> --base-url <url>; then run the panel on that dir (fake mode).
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import pkg from "../package.json" with { type: "json" };
import { createAuth } from "../src/server/auth/auth.service";
import { type Db, openDb } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import type { BackupItemRow } from "../src/server/db/schema";
import * as t from "../src/server/db/schema";
import { loadOrCreateSecret } from "../src/server/secret";
import { setSettings } from "../src/server/settings.service";
import type { Role } from "../src/shared/roles";
import type { JobStep } from "../src/shared/site.types";

/** Must be in the panel's SUPER_ADMIN_EMAILS, or boot demotes the demo super admin. */
export const DEMO_SUPER_ADMIN_EMAIL = "demo@contoh.test";
/** app_meta key marking a demo-only data dir (required to reseed). */
export const DEMO_MARKER = "demo_seed";
/** Cookie file written into the data dir (mode 600). */
export const COOKIE_FILE = "demo-cookies.json";

const HOUR = 3_600_000;
const SAMPLE_EVERY_MS = 10 * 60_000;
const HISTORY_SPAN_MS = 7 * 24 * HOUR - HOUR; // inside the 7-day history retention
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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type P = JobStep["params"];
type S = JobStep["status"];
const step = (key: string, status: S, code: string | null, params: P = {}): JobStep => ({ key, status, code, params });
const ok = (key: string, code: string, params: P = {}) => step(key, "done", code, params);
const err = (code: string, params: P = {}) => JSON.stringify({ code, params, detail: null });

/** Users, 3 sites (one adopted), 7 jobs in every end state and 4 deploys (newest one live). */
function seedSites(tx: Tx, dataDir: string, ago: (h: number) => Date): void {
  tx.insert(t.user)
    .values(USERS.map((u, i) => ({ ...u, emailVerified: true, createdAt: ago(170 - i * 20) })))
    .run();
  // [name, port, database, runtime, managed, hosts]; makuro-solusi = the fake pm2 app + ingress, adopted.
  const sites = [
    ["toko-kopi", 3010, "toko_kopi", "native", true, ["toko-kopi.contoh.com"]],
    ["blog", 3011, null, "grun", true, ["blog.contoh.com", "blog.contoh.test"]],
    ["makuro-solusi", 3005, null, "grun", false, ["solusi.contoh.test"]],
  ] as const;
  for (const [i, [name, port, database, runtime, managed, hosts]] of sites.entries()) {
    const dir = join(dataDir, "demo-sites", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".env"), `PORT=${port}\n`, { mode: 0o600 });
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
  const binFile = join(dataDir, "demo-sites", "toko-kopi", "app");
  writeFileSync(binFile, "demo binary\n", { mode: 0o755 });
  const bin = statSync(binFile);

  const create = (site: string) => [
    ok("validate", "validated"),
    ok("folder", "folder_created"),
    ok("env_write", "env_written"),
    ok("ingress", "ingress_added"),
    ok("dns", "dns_created"),
    ok("tunnel_restart", "tunnel_restarted"),
    ok("domain_probe", "domain_reachable", { hostname: `${site}.contoh.com` }),
  ];
  const head = (runtime: string) => [
    ok("stage", "staged"),
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
  const timeout = { seconds: 60, last: 502 };
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
      [ok("validate", "validated"), ok("ingress", "ingress_added"), step("dns", "failed", "dns_conflict", dnsConflict)],
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

/** 5 backup runs (succeeded/failed/partial) with items and 3 restore tests. */
function seedBackups(tx: Tx, ago: (h: number) => Date): void {
  const item = (
    kind: BackupItemRow["kind"],
    name: string,
    run: string,
    good: boolean,
    errorCode: BackupItemRow["errorCode"],
  ): BackupItemRow => ({
    kind,
    name,
    key: `panel-termux/${run}/${kind}-${name}.gz`,
    sizeBytes: good ? 2_400_000 + name.length * 91_000 : null,
    ok: good,
    error: good ? null : "demo failure",
    errorCode: good ? null : errorCode,
    sha256: good ? SHA("f") : null,
    checked: good,
  });
  // [id, trigger, status, hours ago]
  const runs = [
    ["bk-demo-1", "schedule", "succeeded", 148],
    ["bk-demo-2", "schedule", "succeeded", 124],
    ["bk-demo-3", "schedule", "failed", 100],
    ["bk-demo-4", "manual", "partial", 52],
    ["bk-demo-5", "schedule", "succeeded", 4],
  ] as const;
  for (const [id, trigger, status, h] of runs) {
    const rest = status !== "failed";
    const items = [
      item("database", "toko_kopi", id, status === "succeeded", "produce_failed"),
      item("panel", "panel.db", id, rest, "upload_failed"),
      item("sites", "toko-kopi", id, rest, "upload_failed"),
      item("cloudflared", "config.yml", id, rest, "upload_failed"),
    ];
    tx.insert(t.backupRun)
      .values({
        id,
        trigger,
        status,
        items,
        error: rest ? null : "upload_failed",
        actorId: trigger === "manual" ? "demo-super" : null,
        startedAt: ago(h),
        finishedAt: new Date(ago(h).getTime() + 240_000),
        includesSecrets: false,
        panelVersion: pkg.version,
      })
      .run();
  }
  // [id, run, target db, status, actor, hours ago, dropped hours ago]
  const restores = [
    ["rs-demo-1", "bk-demo-2", "toko_kopi_uji_1", "succeeded", "demo-super", 120, 118],
    ["rs-demo-2", "bk-demo-5", "toko_kopi_uji_2", "succeeded", "demo-super", 3, null],
    ["rs-demo-3", "bk-demo-1", "toko_kopi_uji_3", "failed", "demo-admin", 140, null],
  ] as const;
  for (const [id, runId, targetDb, status, actorId, h, dropped] of restores)
    tx.insert(t.backupRestore)
      .values({
        id,
        runId,
        itemIndex: 0,
        sourceName: "toko_kopi",
        targetDb,
        status,
        actorId,
        startedAt: ago(h),
        finishedAt: ago(h - 0.1),
        tableCount: status === "succeeded" ? 12 : null,
        error: status === "failed" ? "psql exited with 3" : null,
        droppedAt: dropped === null ? null : ago(dropped),
      })
      .run();
}

/** 20 audit entries over the week across many actions (sign-ins come from the session hook). */
function seedAudit(tx: Tx, ago: (h: number) => Date): void {
  const audits: [string, string, string | null, Record<string, unknown> | null][] = [
    ["demo-super", "site.create", "toko-kopi", { port: 3010 }],
    ["demo-admin", "site.create", "blog", { port: 3011 }],
    ["demo-super", "site.adopt", "makuro-solusi", { app: "makuro-solusi" }],
    ["demo-super", "user.role_change", "demo-admin", { from: "user", to: "admin" }],
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
    ["demo-super", "session.revoke", "demo-user2", null],
    ["demo-super", "audit.export", null, { rows: 120 }],
    ["demo-admin", "log.download", "makuro-solusi", null],
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
    userAgent: "Chrome · Android",
  }));
  tx.insert(t.auditLog).values(rows).run();
}

/** Closed problems; 7 days of metric samples and checks of the fake ingress hosts. */
function seedMonitor(tx: Tx, now: number): void {
  // [code, kind, target, severity, params, opened h ago, closed h ago]
  const events = [
    ["domain_unreachable", "domain", "old.contoh.test", "danger", { failures: 3 }, 150, 149],
    ["app_errored", "app", "kasir-lama", "danger", { restarts: 15 }, 130, 128],
    ["backup_failed", "backup", "backup", "danger", {}, 100, 76],
    ["battery_hot", "battery", "battery", "warning", { temperatureC: 43.5 }, 70, 69.5],
    ["disk_low", "disk", "disk", "warning", { freePct: 9 }, 40, 30],
    ["internet_down", "network", "internet", "danger", { domains: 3 }, 26, 25.8],
    ["site_job_failed", "site", "toko-kopi", "danger", { jobId: "job-demo-04" }, 48, 47],
  ] as const;
  tx.insert(t.problemEvent)
    .values(
      events.map(([code, kind, target, severity, params, from, to]) => ({
        key: `${code}:${target}`,
        code,
        kind,
        target,
        severity,
        params,
        openedAt: now - from * HOUR,
        lastSeenAt: now - to * HOUR,
        closedAt: now - to * HOUR,
        notifiedState: "closed" as const,
        notifiedSeverity: severity,
        lastSentAt: now - to * HOUR,
      })),
    )
    .run();
  const samples: (typeof t.metricSample.$inferInsert)[] = [];
  const checks: (typeof t.checkResult.$inferInsert)[] = [];
  for (let at = now - HISTORY_SPAN_MS, i = 0; at < now; at += SAMPLE_EVERY_MS, i++) {
    const w = Math.sin(i / 24);
    samples.push({
      at,
      batteryPct: Math.round(70 + 25 * Math.sin(i / 40)),
      batteryStatus: i % 80 < 40 ? "charging" : "discharging",
      batteryTempC: 31 + 4 * w,
      memAvailableMb: Math.round(3_800 + 900 * w),
      memTotalMb: 11_776,
      diskFreeMb: 186_000 - i * 4,
      load1: 18 + 4 * w,
      load5: 19 + 3 * w,
      problemsDanger: i % 90 === 0 ? 1 : 0,
      problemsWarning: i % 50 < 3 ? 1 : 0,
    });
    for (const hostname of ["db.contoh.test", "old.contoh.test", "solusi.contoh.test"])
      checks.push({
        hostname,
        at,
        status: hostname.startsWith("old.") && i % 7 === 0 ? null : 200,
        ms: 40 + (i % 9) * 12,
        localStatus: null,
      });
  }
  tx.insert(t.metricSample).values(samples).run();
  tx.insert(t.checkResult).values(checks).run();
}

/** Seeds `dataDir` (migrations, demo rows, sessions), writes the cookie file; returns row counts. */
export async function seedDemo(opts: { dataDir: string; baseUrl: string }): Promise<Record<string, number>> {
  const dataDir = resolve(opts.dataDir);
  assertDemoDir(dataDir);
  new URL(opts.baseUrl); // throws on an invalid --base-url before anything is written
  const { secret } = loadOrCreateSecret(dataDir);
  const db = openDb(dataDir);
  try {
    runMigrations(db);
    const now = Date.now();
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
      seedSites(tx, dataDir, ago);
      seedBackups(tx, ago);
      seedAudit(tx, ago);
      seedMonitor(tx, now);
    });
    // Fictional S3 target: backups count as configured (the 03:00 run fails harmlessly).
    const s3 = {
      "backup.s3_endpoint": "https://s3.contoh.test",
      "backup.s3_bucket": "cadangan-demo",
      "backup.s3_access_key_id": "DEMOKEYID0001",
      "backup.s3_secret_access_key": "DEMOSECRETKEY0001",
    };
    setSettings({ db, secret }, s3, "demo-super");

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
  const { values } = parseArgs({ options: { "data-dir": { type: "string" }, "base-url": { type: "string" } } });
  const dataDir = values["data-dir"];
  const baseUrl = values["base-url"];
  if (!dataDir || !baseUrl) {
    console.error("usage: bun scripts/demo-seed.ts --data-dir <dir> --base-url <url>");
    process.exit(2);
  }
  try {
    console.log(`demo-seed: ${JSON.stringify(await seedDemo({ dataDir, baseUrl }))}`);
    console.log(`demo-seed: cookies (mode 600) in ${join(resolve(dataDir), COOKIE_FILE)}`);
    console.log(`demo-seed: start the panel with SUPER_ADMIN_EMAILS=${DEMO_SUPER_ADMIN_EMAIL}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
