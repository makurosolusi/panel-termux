import { useLayoutEffect, useRef } from "react";

/**
 * Where focus goes back to: the focused element, or — when it is an item of a Radix menu (unmounted as soon as the
 * menu closes) — the menu's trigger, which the menu content names in `aria-labelledby`.
 */
export function focusOpener(active: Element | null): HTMLElement | null {
  const menu = active?.closest('[role="menu"]');
  const triggerId = menu?.getAttribute("aria-labelledby");
  const el = triggerId ? (active?.ownerDocument.getElementById(triggerId) ?? active) : active;
  return el && "focus" in el ? (el as HTMLElement) : null;
}

/**
 * Remembers the element focused when `open` turns true and returns the `onCloseAutoFocus` handler for the dialog's
 * content, which focuses it again. Radix restores focus only to its own Trigger, so dialogs opened by state (row
 * buttons, menus, a button that also changes the page) otherwise leave focus on <body>. The handler runs after the
 * content unmounted; focusing earlier (on `open=false`) loses to the still-active focus trap. Layout effect: it runs
 * before Radix's FocusScope moves focus into the dialog.
 */
export function useReturnFocus(open: boolean): (e: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = focusOpener(document.activeElement);
  }, [open]);
  return (e) => {
    const el = opener.current;
    opener.current = null;
    if (!el?.isConnected) return; // Radix's default (trigger, if any) applies
    e.preventDefault();
    el.focus();
  };
}
