// Scroll to the URL fragment once per navigation (QA 29 M1). The app mounts after the bootstrap's dynamic import and
// most sections render after their own fetch, so the browser's native fragment jump happens before the target exists.
// Landing and Sites keep their 0.5.x ids as hidden spans (landing.anchors.tsx, site.legacy-anchor.tsx), so the raw id
// finds them; /dev and /dev/settings map old ids in code (dev.anchors.ts), reused here.
import type { DataRouter } from "react-router";
import { devAnchorFromHash, settingsAnchorFromHash } from "@/web/shared/dev.anchors";

/** How long a late-rendering target is waited for. */
export const HASH_WAIT_MS = 3000;
const POLL_MS = 100;

/** Element named by a URL hash: the id itself, else its /dev or /dev/settings 0.5.x alias. */
export function resolveHashTarget(hash: string, byId: (id: string) => Element | null): Element | null {
  const raw = decodeHashId(hash.replace(/^#/, ""));
  if (!raw) return null;
  for (const id of new Set([raw, devAnchorFromHash(raw), settingsAnchorFromHash(raw)])) {
    const el = byId(id);
    if (el) return el;
  }
  return null;
}

/** Percent-decoded id; a malformed escape is looked up as typed. */
function decodeHashId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id; // URIError: not a valid escape sequence, so the literal text is the only sensible id
  }
}

/** Polls `find` until it returns a value, `timeoutMs` passes (→ null) or `signal` aborts (→ null). */
export function waitFor<T>(
  find: () => T | null,
  {
    timeoutMs = HASH_WAIT_MS,
    intervalMs = POLL_MS,
    signal,
  }: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<T | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (signal?.aborted) return resolve(null);
      const found = find();
      if (found !== null) return resolve(found);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown", "mousedown"] as const;
/** Consecutive in-place polls after which the target counts as settled. */
const STABLE_POLLS = 5;

type Alignable = Pick<Element, "getBoundingClientRect" | "scrollIntoView">;

/**
 * Keeps `el` aligned to the viewport top (`marginTop` = its scroll-margin-top) while the page settles. A single
 * scrollIntoView is not enough: on a cold load the target can exist before the document is tall enough to scroll, and
 * content rendered above it later pushes it down (0.6.0 QA: /panel/sites#not-managed landed at top 1198 on 4/17 loads).
 * Re-aligns whenever the target is off its place; stops once it stayed in place for STABLE_POLLS polls, after
 * `timeoutMs`, or when `signal` aborts (user input, newer navigation).
 */
export function keepAligned(
  el: Alignable,
  marginTop: number,
  {
    timeoutMs = HASH_WAIT_MS,
    intervalMs = POLL_MS,
    signal,
  }: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let inPlace = 0;
    const tick = () => {
      if (signal?.aborted) return resolve();
      if (Math.abs(el.getBoundingClientRect().top - marginTop) <= 2) inPlace++;
      else {
        inPlace = 0;
        // "auto" follows CSS scroll-behavior, which styles.css forces to auto under prefers-reduced-motion
        el.scrollIntoView({ behavior: "auto", block: "start" });
      }
      if (inPlace >= STABLE_POLLS || Date.now() >= deadline) return resolve();
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/** Scrolls to `hash` once its target exists and keeps it there while the page settles; the user's input wins. */
function scrollToHash(hash: string, signal: AbortSignal): void {
  const done = new AbortController();
  const userMoved = new AbortController();
  const stop = () => userMoved.abort();
  const listening = AbortSignal.any([signal, done.signal]);
  for (const e of USER_SCROLL_EVENTS)
    window.addEventListener(e, stop, { passive: true, once: true, signal: listening });
  const both = AbortSignal.any([signal, userMoved.signal]);
  void waitFor(() => resolveHashTarget(hash, (id) => document.getElementById(id)), { signal: both })
    .then((el) => {
      if (!el || both.aborted) return;
      const marginTop = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      return keepAligned(el, marginTop, { signal: both });
    })
    .finally(() => done.abort());
}

/**
 * Follows the fragment of the first load and of every PUSH/REPLACE navigation, after its loaders settle. Back/forward
 * (POP) is left to ScrollRestoration. A newer navigation cancels a pending wait.
 */
export function followUrlHash(router: Pick<DataRouter, "state" | "subscribe">): void {
  let lastKey: string | null = null;
  let pending: AbortController | null = null;
  const onState = (state: DataRouter["state"]) => {
    if (!state.initialized || state.navigation.state !== "idle" || state.location.key === lastKey) return;
    const first = lastKey === null;
    lastKey = state.location.key;
    pending?.abort();
    pending = null;
    if (!state.location.hash || (!first && state.historyAction === "POP")) return;
    pending = new AbortController();
    scrollToHash(state.location.hash, pending.signal);
  };
  router.subscribe(onState);
  onState(router.state);
}
