// `panel doctor [--json]` (PLAN/07 §3, K5, K12): probe + bootstrap checks + the server's Persiapan checks with the
// card's own copy, printed plainly or as one DoctorReport. Read-only: no file is created or written (lab L6).
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import pkg from "../../package.json" with { type: "json" };
import type { Db } from "../server/db/client";
import { latestSchemaVersion, runMigrations } from "../server/db/migrate";
import * as schema from "../server/db/schema";
import { createIntegration } from "../server/sites/integration.service";
import {
  DOCTOR_SCHEMA,
  type DoctorCheck,
  type DoctorGroup,
  type DoctorReport,
  type DoctorState,
} from "../shared/doctor.types";
import type { IntegrationCheck } from "../shared/site.types";
import { idSiteSetup } from "../web/i18n/id.site.setup";
import type { CliHost } from "./cli.host";
import type { Command } from "./cli.main";
import type { CliOut } from "./cli.output";
import { bootstrapChecks } from "./doctor.checks";
import { collectDoctorProbe } from "./doctor.probe";

const GROUPS: Record<DoctorGroup, string> = {
  termux: "Termux",
  paket: "Paket",
  layanan: "Layanan",
  panel: "Panel",
  situs: "Situs (sama dengan kartu Persiapan)",
  tunnel: "Tunnel",
  boot: "Boot",
  manual: "Tidak bisa dicek dari Termux",
};
const ORDER = Object.keys(GROUPS) as DoctorGroup[];
const DB_FILE = "panel.db";
const PERSIAPAN = "buka Situs → Persiapan di panel";

type DoctorDb = { db: Db; note: string | null };

const memoryDb = (note: string | null): DoctorDb => {
  const db = drizzle({ client: new Database(":memory:", { strict: true }), schema }) as Db;
  runMigrations(db);
  return { db, note };
};

/**
 * panel.db read-only, only when that cannot create a file (lab L6: a `-wal` without `-shm` makes SQLite write one);
 * otherwise, or when it is unreadable/older, a migrated `:memory:` DB (site settings at their defaults).
 */
export function openDoctorDb(dataDir: string): DoctorDb {
  const file = join(dataDir, DB_FILE);
  if (!existsSync(file)) return memoryDb(null);
  const defaults = "pengaturan situs memakai nilai bawaan";
  if (existsSync(`${file}-wal`) && !existsSync(`${file}-shm`))
    return memoryDb(`panel.db tidak dibuka (panel mati dengan WAL tersisa); ${defaults}.`);
  let client: Database | undefined;
  try {
    client = new Database(file, { readonly: true, strict: true });
    const row = client.query<{ value: string }, []>("select value from app_meta where key = 'schema_version'").get();
    if (row?.value === latestSchemaVersion()) return { db: drizzle({ client, schema }) as Db, note: null };
    client.close();
    return memoryDb(`panel.db versi lama (panel belum dimulai ulang setelah update); ${defaults}.`);
  } catch (e) {
    client?.close();
    return memoryDb(`panel.db tidak bisa dibaca (${(e as Error).message}); ${defaults}.`);
  }
}

/** One Persiapan card row as a doctor check: same key, state, params and label as the UI (K5). */
export function siteCheck(c: IntegrationCheck, fixable: ReadonlySet<string>): DoctorCheck {
  const copy = idSiteSetup.checks[c.key];
  const text = (c.state === "ok" ? copy.ok : (copy as Record<string, typeof copy.ok>)[c.state]) ?? copy.ok;
  const label = typeof text === "function" ? text(c.params) : text;
  const hint =
    c.state === "ok"
      ? null
      : c.key === "cloudflare_token"
        ? idSiteSetup.tokenLink
        : fixable.has(c.key)
          ? `${PERSIAPAN}, tekan ${idSiteSetup.fix}`
          : PERSIAPAN;
  return {
    group: "situs",
    key: c.key,
    state: c.state,
    label,
    action: c.state === "ok" ? null : "ui",
    hint,
    params: c.params,
  };
}

async function siteChecks(host: CliHost, dataDir: string, out: CliOut): Promise<DoctorCheck[]> {
  const { db, note } = openDoctorDb(dataDir);
  if (note) out.note(`ℹ️ ${note}`);
  try {
    const integration = await createIntegration({ db, secret: "", system: host.system() }).get();
    const fixable = new Set((integration.fixes ?? []).filter((f) => f.available).flatMap((f) => f.checks));
    return (integration.checks ?? []).map((c) => siteCheck(c, fixable));
  } finally {
    db.$client.close();
  }
}

/** Probe, check and report for `host`; pure of output (tests call it directly). */
export async function runDoctor(host: CliHost, out: CliOut): Promise<DoctorReport> {
  const probe = await collectDoctorProbe(host);
  const checks = bootstrapChecks(probe);
  if (checks.some((c) => c.key === "termux_prefix" && c.state === "ok"))
    checks.push(...(await siteChecks(host, probe.dataDir, out)));
  checks.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
  const summary: Record<DoctorState, number> = { ok: 0, warning: 0, error: 0, info: 0 };
  for (const c of checks) summary[c.state]++;
  return {
    schema: DOCTOR_SCHEMA,
    panelVersion: pkg.version,
    mode: host.mode,
    ok: summary.error === 0,
    summary,
    checks,
  };
}

function print(report: DoctorReport, out: CliOut): void {
  out.line(`Panel Termux ${report.panelVersion} — pemeriksaan HP (tidak ada yang diubah)`);
  for (const group of ORDER) {
    const rows = report.checks.filter((c) => c.group === group);
    if (!rows.length) continue;
    out.line();
    out.line(GROUPS[group]);
    for (const c of rows) out.check(c.state, c.label, c.hint);
  }
  if (report.checks.some((c) => c.key === "panel_health" && c.state === "ok"))
    out.line("\nℹ️ Checklist penyiapan ada di Administrasi → Penyiapan");
  out.line(`\nHasil: ${report.summary.error} error, ${report.summary.warning} peringatan.`);
}

/** `panel doctor [--json]`: exit 0 without errors (warnings allowed), 1 with at least one (§2.2). */
export const doctorCommand: Command = async (args, io) => {
  const host = await io.host();
  // D15: a server module logging info would land on stdout and break `--json`; send it to stderr meanwhile.
  const log = console.log;
  console.log = console.error;
  let report: DoctorReport;
  try {
    report = await runDoctor(host, io.out);
  } finally {
    console.log = log;
  }
  if (args.values.json) io.out.json(report);
  else print(report, io.out);
  return report.ok ? 0 : 1;
};
