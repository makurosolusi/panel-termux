// Canonical status vocabulary (PLAN/01 §3.1, DECISIONS B12/A10). Frozen after W3: domains map their raw states to a
// StatusKey in their own `*.status-key.ts`; a new key is a written request to the shell owner.
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleMinusIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  type LucideIcon,
  OctagonXIcon,
  RefreshCwOffIcon,
  TriangleAlertIcon,
  Undo2Icon,
  UnplugIcon,
  WifiOffIcon,
} from "lucide-react";
import type { LogLevel } from "@/shared/dev.types";
import type { ProblemSeverity } from "@/shared/monitor.types";
import { tStatus, tStatusHelp } from "@/web/i18n/en.status";
import type { StatusTone } from "./status.tone";

/** Canonical display state; every badge/dot/icon in the panel is one of these. */
export type StatusKey =
  | "running"
  | "healthy"
  | "succeeded"
  | "done"
  | "stopped"
  | "pending"
  | "skipped"
  | "unchecked"
  | "not_deployed"
  | "unknown"
  | "auth_required"
  | "starting"
  | "restarting"
  | "attention"
  | "partial"
  | "undone"
  | "not_configured"
  | "unstable"
  | "down"
  | "errored"
  | "failed"
  | "unhealthy"
  | "rolled_back"
  | "crash_loop"
  | "interrupted"
  | "tunnel_down"
  | "key_mismatch"
  | "processing";

/** Resolved status for rendering. `label`/`help` come from `id.status` / `id.statusHelp`. */
export type StatusView = {
  key: StatusKey;
  label: string;
  help: string | null;
  tone: StatusTone;
  pulse: boolean;
  icon: LucideIcon;
};

type StatusMeta = { tone: StatusTone; icon: LucideIcon; pulse?: true };

const ok = (icon: LucideIcon = CircleCheckIcon): StatusMeta => ({ tone: "success", icon });
const idle = (icon: LucideIcon): StatusMeta => ({ tone: "neutral", icon });
const warn = (icon: LucideIcon = TriangleAlertIcon): StatusMeta => ({ tone: "warning", icon });
const bad = (icon: LucideIcon = OctagonXIcon): StatusMeta => ({ tone: "danger", icon });
const busy = (tone: StatusTone): StatusMeta => ({ tone, icon: LoaderCircleIcon, pulse: true });

/** Tone/icon/pulse per key. Danger only for real failures that need action; undo/rollback/interruption are warning. */
export const STATUS_META: Readonly<Record<StatusKey, StatusMeta>> = {
  running: ok(),
  healthy: ok(),
  succeeded: ok(),
  done: ok(),
  stopped: idle(CircleMinusIcon),
  pending: idle(CircleDashedIcon),
  skipped: idle(CircleMinusIcon),
  unchecked: idle(CircleDashedIcon),
  not_deployed: idle(CircleDashedIcon),
  unknown: idle(CircleHelpIcon),
  auth_required: idle(LockKeyholeIcon),
  starting: busy("warning"),
  restarting: busy("warning"),
  attention: warn(),
  partial: warn(),
  undone: warn(Undo2Icon),
  not_configured: warn(),
  unstable: warn(),
  down: bad(),
  errored: bad(),
  failed: bad(),
  unhealthy: bad(),
  rolled_back: warn(Undo2Icon),
  crash_loop: bad(RefreshCwOffIcon),
  interrupted: warn(UnplugIcon),
  tunnel_down: bad(WifiOffIcon),
  key_mismatch: bad(KeyRoundIcon),
  processing: busy("info"),
};

/** Every canonical key, in table order. */
export const STATUS_KEYS = Object.keys(STATUS_META) as StatusKey[];

/** Label, help, tone, pulse and icon of a canonical status. */
export function statusView(key: StatusKey): StatusView {
  const meta = STATUS_META[key];
  return {
    key,
    label: tStatus[key],
    help: tStatusHelp[key] ?? null,
    tone: meta.tone,
    pulse: meta.pulse ?? false,
    icon: meta.icon,
  };
}

/** Tone of a monitor problem by severity. */
export const PROBLEM_TONE: Readonly<Record<ProblemSeverity, StatusTone>> = {
  info: "info",
  warning: "warning",
  danger: "danger",
};

/** Tone of a log line by level. */
export const LOG_LEVEL_TONE: Readonly<Record<LogLevel, StatusTone>> = {
  debug: "neutral",
  info: "neutral",
  warn: "warning",
  error: "danger",
};
