import type { BackupStatus } from "../../shared/backup.types";
import type { App, DeviceInfo, Domain, Problem, Service } from "../../shared/panel.types";

/** No finished backup for this long (configured schedule is daily) → warning. */
export const BACKUP_STALE_MS = 36 * 3_600_000;
/** Free disk share below these → warning / danger. */
export const DISK_WARN_RATIO = 0.1;
export const DISK_DANGER_RATIO = 0.05;
/** Battery below this percent while not charging → warning. */
export const BATTERY_LOW_PERCENT = 20;
/** Battery temperature at or above this → warning. */
export const BATTERY_HOT_C = 45;
const HTTP_CLIENT_ERROR = 400;
const HTTP_SERVER_ERROR = 500;

/** Inputs of computeProblems: one overview snapshot. */
export type ProblemInput = {
  services: Service[];
  apps: App[];
  domains: Domain[];
  device: DeviceInfo;
  backup: Pick<BackupStatus, "configured" | "running" | "lastRun">;
  now: Date;
};

function domainProblem(d: Domain): Problem | null {
  const { status, checkedAt } = d.health;
  if (checkedAt === null) return null; // not checked yet
  const p = { kind: "domain", target: d.hostname } as const;
  if (status === null) return { ...p, severity: "danger", message: `${d.hostname} is unreachable` };
  if (status >= HTTP_SERVER_ERROR) return { ...p, severity: "danger", message: `${d.hostname} answers HTTP ${status}` };
  if (status >= HTTP_CLIENT_ERROR)
    return { ...p, severity: "warning", message: `${d.hostname} answers HTTP ${status}` };
  return null;
}

function backupProblem({ configured, running, lastRun }: ProblemInput["backup"], now: Date): Problem | null {
  const p = { kind: "backup", target: "backup" } as const;
  if (!configured) return { ...p, severity: "warning", message: "backups are not configured" };
  if (running) return null;
  if (lastRun?.status === "failed") return { ...p, severity: "danger", message: "the last backup run failed" };
  if (lastRun?.status === "partial")
    return { ...p, severity: "warning", message: "the last backup run was only partly successful" };
  if (!lastRun || now.getTime() - Date.parse(lastRun.startedAt) > BACKUP_STALE_MS)
    return { ...p, severity: "warning", message: "no backup in the last 36 hours" };
  return null;
}

/** Server-side problem list of GET /api/panel/overview, most severe first. */
export function computeProblems({ services, apps, domains, device, backup, now }: ProblemInput): Problem[] {
  const out: Problem[] = [];
  for (const s of services) {
    if (s.wantUp && s.state !== "run")
      out.push({ kind: "service", target: s.name, severity: "danger", message: `service ${s.name} is ${s.state}` });
  }
  for (const a of apps) {
    if (a.status !== "online")
      out.push({
        kind: "app",
        target: a.name,
        severity: a.status === "errored" ? "danger" : "warning",
        message: `app ${a.name} is ${a.status}`,
      });
  }
  for (const d of domains) {
    const p = domainProblem(d);
    if (p) out.push(p);
  }
  const b = backupProblem(backup, now);
  if (b) out.push(b);
  const { freeBytes, totalBytes } = device.disk;
  const free = totalBytes > 0 ? freeBytes / totalBytes : 1;
  if (free < DISK_WARN_RATIO) {
    const pct = Math.round(free * 1000) / 10;
    out.push({
      kind: "disk",
      target: "disk",
      severity: free < DISK_DANGER_RATIO ? "danger" : "warning",
      message: `only ${pct}% disk space left`,
    });
  }
  const bat = device.battery;
  if (bat && bat.percent < BATTERY_LOW_PERCENT && !bat.charging)
    out.push({
      kind: "battery",
      target: "battery",
      severity: "warning",
      message: `battery at ${bat.percent}%, not charging`,
    });
  if (bat && bat.temperatureC >= BATTERY_HOT_C)
    out.push({ kind: "battery", target: "battery", severity: "warning", message: `battery at ${bat.temperatureC}°C` });
  return out.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "danger" ? -1 : 1));
}
