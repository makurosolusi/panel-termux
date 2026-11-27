import type { DevSetup, SetupDismissPut, SetupItem, SetupItemKey, SetupManualPut } from "@/shared/dev.types";
import { tDevSetup } from "@/web/i18n/en.dev.setup";
import { runApiAction } from "@/web/shared/api.action";
import { apiFetch, apiUrl } from "@/web/shared/api.client";

// Decisions of the onboarding card/banner (PLAN/05 F1, §3.1): which items show, progress, visibility, actions; plus
// the two PUTs both use.

const t = tDevSetup;

/** Cloudflare Access recipe (README "Install on your phone", step 4). */
export const ACCESS_GUIDE_URL = "https://github.com/makurosolusi/panel-termux#install-on-your-phone";
/** Copy-paste fallback for saving the data key from a laptop; `<phone>` is the owner's SSH host alias. */
export const SECRET_SCP_COMMAND = "scp <phone>:panel/data/secret ./panel-termux-secret";
/** Anchor of the onboarding card on /dev (target of the banner and the Information rows). */
export const ONBOARDING_ANCHOR = "setup";
/** Anchor of PLAN/04's DataKeyCard on /dev (download lives there, with its fresh-session handling). */
export const DATA_KEY_ANCHOR = "data-key";
/** 0.5.x Indonesian ids of the two /dev anchors, kept so old bookmarks and stored problem links still land. */
const LEGACY_DEV_ANCHOR: Readonly<Record<string, string>> = {
  penyiapan: ONBOARDING_ANCHOR,
  "kunci-data": DATA_KEY_ANCHOR,
};

/** Anchor named by a /dev URL hash (`#kunci-data` → `data-key`); an unknown id passes through unchanged. */
export function devAnchorFromHash(hash: string): string {
  const id = hash.replace(/^#/, "");
  return LEGACY_DEV_ANCHOR[id] ?? id;
}

/** Items the owner may tick by hand (server MANUAL_KEYS). */
const MANUAL: ReadonlySet<SetupItemKey> = new Set(["access", "secret_saved"]);

/** Applicable items in server (table) order, without the 0.2.x `adopt_sites`. */
export const visibleItems = (setup: DevSetup): SetupItem[] =>
  setup.items.filter((i) => i.key !== "adopt_sites" && i.applicable !== false);

/** "n of total done": applicable required + recommended items only (optional never counts). */
export function setupProgress(setup: DevSetup): { done: number; total: number } {
  const counted = visibleItems(setup).filter((i) => i.level !== "optional");
  return { done: counted.filter((i) => i.done).length, total: counted.length };
}

/** `complete` from the server, or derived the same way while the field is optional. */
export function isComplete(setup: DevSetup): boolean {
  if (setup.complete !== undefined) return setup.complete;
  const p = setupProgress(setup);
  return p.done === p.total;
}

/** Card on /dev: not dismissed and not complete, or reopened by hand (then shown even when complete). */
export const cardVisible = (setup: DevSetup, reopened: boolean): boolean =>
  !setup.dismissedAt && (reopened || !isComplete(setup));

/** Banner on Overview: only while the guide is pending and not dismissed. */
export const bannerVisible = (setup: DevSetup): boolean => !setup.dismissedAt && !isComplete(setup);

/** "Setup guide" reopen needs a PUT only when the guide was dismissed (otherwise it is local state). */
export const reopenNeedsPut = (setup: DevSetup): boolean => Boolean(setup.dismissedAt);

/** What the tick button of an item does: tick, untick, or nothing (auto items and auto-done items). */
export function manualToggle(item: SetupItem): "tick" | "untick" | null {
  if (!MANUAL.has(item.key)) return null;
  if (!item.done) return "tick";
  return item.source === "manual" ? "untick" : null;
}

/** Label of the tick button of a manual item. */
export const tickLabel = (key: SetupItemKey): string => (key === "secret_saved" ? t.secretDone : t.accessDone);

/** Primary action of a pending item: in-app route, same-page anchor or external link. */
export type ItemAction = { kind: "route" | "anchor" | "external"; to: string; label: string };

/** Primary action of an item (shown only while it is not done). */
export function itemAction(item: SetupItem): ItemAction | null {
  const label = item.key === "adopt_sites" ? "" : t.items[item.key].action;
  switch (item.key) {
    case "access":
      return { kind: "external", to: ACCESS_GUIDE_URL, label };
    case "secret_saved":
      return { kind: "anchor", to: `#${DATA_KEY_ANCHOR}`, label };
    case "backup":
      return item.needsFirstRun
        ? { kind: "route", to: "/panel/backups", label: t.backupFirstRun }
        : { kind: "route", to: "/dev/settings#backup", label };
    case "cloudflare_token":
      return { kind: "route", to: "/dev/settings#cloudflare", label };
    case "apps_json":
      return { kind: "route", to: "/panel/sites#setup", label };
    case "first_site":
      return { kind: "route", to: "/panel/sites/new", label };
    case "admins":
      return { kind: "route", to: "/dev/users", label };
    default:
      return null;
  }
}

/** GET /api/dev/setup (super_admin). */
export const SETUP_URL = apiUrl("/api/dev", "/setup");

/** PUT /setup/dismiss, toasting the outcome; resolves to whether it succeeded (no optimistic update, F1). */
export const saveDismissed = (dismissed: boolean): Promise<boolean> =>
  runApiAction(
    () => apiFetch<DevSetup>("PUT", `${SETUP_URL}/dismiss`, { dismissed } satisfies SetupDismissPut),
    dismissed ? t.hidden : t.shown,
  );

/** PUT /setup/items/:key (access / secret_saved only), toasting the outcome. */
export const saveManual = (key: SetupItemKey, done: boolean): Promise<boolean> =>
  runApiAction(
    () => apiFetch<DevSetup>("PUT", `${SETUP_URL}/items/${encodeURIComponent(key)}`, { done } satisfies SetupManualPut),
    done ? t.markedDone : t.markedUndone,
  );
