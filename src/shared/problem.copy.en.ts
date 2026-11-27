// English text of every ProblemCode, shared by the Overview (web) and Telegram (server) so both say the same thing
// (PLAN/02 K2 §5.7, PLAN/08 §5). A deliberate exception to "UI strings live in src/web/i18n": the server needs the same
// words. The web imports only this module; the `id` overlay (problem.copy.id.ts, domain "problem") patches `tProblem`
// in place. The server never registers overlays and picks a language with `problemCopy(locale)` (problem.copy.ts).
import { formatBytes, formatDuration, formatNumber, formatTemperature } from "./format.number";
import { type Messages, msg } from "./i18n";
import type { AlertErrorCode, Problem, ProblemCode, ProblemParams } from "./monitor.types";
import { num, str } from "./problem.copy.params";

/** The part of a Problem the copy reads. */
export type ProblemText = Pick<Problem, "code" | "target" | "params">;

/** How a backup item reads mid-sentence; only databases have a meaningful own name (the others are fixed ids). */
const BACKUP_ITEM: Partial<Record<string, string>> = {
  globals: "Postgres roles",
  panel: "panel database",
  sites: "site files",
  cloudflared: "tunnel config",
  secrets: "secret keys",
};

function domainReason(_target: string, params: ProblemParams): string {
  const local = num(params.local);
  const port = num(params.port);
  if (num(params.status) === 530) return "Cloudflare can't reach the cloudflared tunnel on the phone.";
  if (local !== null) return `The app on the phone answers ${local}, so the problem is in the tunnel.`;
  return port !== null ? `The app on port ${port} isn't answering.` : "The domain isn't answering from the internet.";
}

const ALERT_REASON: Partial<Record<AlertErrorCode, string>> = {
  telegram_token_invalid: "Telegram rejected the bot token. Check the token in Settings.",
  telegram_chat_not_found: "The target chat wasn't found. Send the bot a message, then pick the chat again.",
  telegram_forbidden: "The bot was blocked or removed from the group.",
  telegram_conflict: "Another app is using the bot (webhook).",
};
const ALERT_REASON_OTHER = "Telegram can't be reached from the phone.";

const n0 = (v: unknown) => formatNumber(num(v) ?? 0, 0, "en");

/** English problem copy: per code a title and a detail, `(target, params)`; plus the recovery lines. */
export const tProblem = msg("problem", {
  codes: {
    service_down: {
      title: (target: string) => `Service ${target} is down`,
      detail: (_target: string, params: ProblemParams) => {
        const sec = num(params.downSec);
        return sec === null ? "It should be running." : `It should be running. Down for ${formatDuration(sec, "en")}.`;
      },
    },
    service_crash_loop: {
      title: (target: string) => `Service ${target} keeps restarting`,
      detail: (target: string) => `runit starts it again but it stops right away. Check the ${target} log.`,
    },
    pm2_unavailable: {
      title: () => "pm2 isn't running",
      detail: () => "The pm2 service isn't running, so every site is down.",
    },
    app_errored: {
      title: (target: string) => `App ${target} errored`,
      detail: (_target: string, params: ProblemParams) =>
        `pm2 gave up after ${n0(params.restarts)} failed attempts. Check the stderr log.`,
    },
    app_crash_loop: {
      title: (target: string) => `App ${target} keeps restarting`,
      detail: (_target: string, params: ProblemParams) =>
        `${n0(params.restarts10m)}× in the last 10 min. Check the stderr log.`,
    },
    domain_unreachable: { title: (target: string) => `${target} is unreachable`, detail: domainReason },
    domain_http_error: {
      title: (target: string, params: ProblemParams) => `${target} answers HTTP ${str(params.status)}`,
      detail: domainReason,
    },
    internet_down: {
      title: () => "The phone is offline",
      detail: () => "No domain can be reached from the phone. Alerts are sent once the connection is back.",
    },
    backup_not_configured: {
      title: () => "Backup isn't set up",
      detail: () => "Without a backup, site data is lost if the phone breaks. Set up R2/S3 storage.",
    },
    backup_failed: {
      title: () => "The last backup failed",
      detail: () => "See the details on the Backup page.",
    },
    backup_partial: {
      title: () => "The last backup only partly succeeded",
      detail: () => "See the failed items on the Backup page.",
    },
    backup_stale: {
      title: (_target: string, params: ProblemParams) => `No backup in the last ${n0(params.hours)} hours`,
      detail: () => "The daily backup may not be running.",
    },
    backup_item_stale: {
      title: (_target: string, params: ProblemParams) => {
        const hours = num(params.hours);
        const name = BACKUP_ITEM[str(params.itemKind)] ?? str(params.name);
        return hours === null
          ? `Backup of ${name} has never succeeded`
          : `Backup of ${name} hasn't succeeded for ${formatNumber(hours, 0, "en")} hours`;
      },
      detail: () => "This item failed in the last backup. See the Backup page.",
    },
    backup_status_error: {
      title: () => "Can't read the backup status",
      detail: () => "Open System health to see why.",
    },
    backup_secrets_included: {
      title: () => "Backups include secrets",
      detail: () =>
        "Tokens and keys are stored in the bucket too. Guard access to the bucket, or turn it off in Settings.",
    },
    key_mismatch: {
      title: () => "The data key doesn't match",
      detail: () => "Secret settings can't be decrypted. Open System health → Data key.",
    },
    access_not_seen: {
      title: () => "Cloudflare Access not detected",
      detail: () => "The panel was opened without going through Cloudflare Access. Check the Access rules.",
    },
    disk_low: {
      title: () => "Storage is almost full",
      detail: (_target: string, params: ProblemParams) =>
        `Only ${formatNumber(num(params.freePct) ?? 0, 1, "en")}% (${formatBytes(num(params.freeBytes) ?? 0, "en")}) free.`,
    },
    battery_low: {
      title: (_target: string, params: ProblemParams) => `Battery at ${n0(params.percent)}% and not charging`,
      detail: () => "The server goes down when the battery runs out. Plug in a charger.",
    },
    battery_hot: {
      title: (_target: string, params: ProblemParams) =>
        `Battery is hot (${formatTemperature(num(params.temperatureC), "en")})`,
      detail: () => "Move the phone somewhere cooler or take off its case.",
    },
    alerts_failing: {
      title: () => "Telegram alerts aren't being delivered",
      detail: (_target: string, params: ProblemParams) =>
        ALERT_REASON[str(params.reason) as AlertErrorCode] ?? ALERT_REASON_OTHER,
    },
    site_job_failed: {
      title: (target: string) => `A change to site ${target} didn't finish`,
      detail: () => "Open this change to clean up or try again.",
    },
    host_rebooted: {
      title: () => "The phone just restarted",
      detail: (_target: string, params: ProblemParams) =>
        `Up ${n0(params.uptimeMin)} min. Check that every service is running.`,
    },
    panel_restarted_unexpectedly: {
      title: () => "The panel stopped unexpectedly",
      detail: () => "The panel wasn't shut down cleanly (Android may have stopped it).",
    },
  } satisfies Record<ProblemCode, { title: unknown; detail: unknown }>,
  /** "{title} · lasted {duration}" (internet has its own sentence). */
  recovered: (title: string, durationSec: number) => `${title} · lasted ${formatDuration(durationSec, "en")}`,
  internetRecovered: (durationSec: number) => `The phone was offline for ${formatDuration(durationSec, "en")}`,
  /** A problem that ended while the panel was not running (PLAN/02 §4.6 step 3). */
  recoveredWhileOffline: (title: string, lastSeenAgoSec: number) =>
    `${title} · recovered while the panel wasn't running (last seen ${formatDuration(lastSeenAgoSec, "en")} ago)`,
});

/** Problem copy in one language: `tProblem` or an overlay typed against it. */
export type ProblemCopy = Messages<typeof tProblem>;

/** The four lines a consumer renders, bound to one copy. */
export function problemText(copy: ProblemCopy) {
  const title = (p: ProblemText): string => copy.codes[p.code].title(p.target, p.params);
  return {
    /** One-line headline of a problem. */
    title,
    /** What it means / what to do, one or two sentences. */
    detail: (p: ProblemText): string => copy.codes[p.code].detail(p.target, p.params),
    /** Recovery line without the "RECOVERED" label. */
    recovered: (p: ProblemText, durationSec: number): string =>
      p.code === "internet_down" ? copy.internetRecovered(durationSec) : copy.recovered(title(p), durationSec),
    /** Recovery line for a problem that ended while the panel was not running. */
    recoveredWhileOffline: (p: ProblemText, lastSeenAgoSec: number): string =>
      copy.recoveredWhileOffline(title(p), lastSeenAgoSec),
  };
}

/** Lines in the page's language (web: English, or Indonesian once the overlay patched `tProblem`). */
export const { title, detail, recovered, recoveredWhileOffline } = problemText(tProblem);
