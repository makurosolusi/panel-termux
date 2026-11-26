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
 * Returns focus to the element that was focused when `open` turned true, once it turns false again. Radix restores
 * focus only to its own Trigger, so dialogs opened by state (row buttons, menus) otherwise leave focus on <body>.
 * Layout effect: it runs before Radix's FocusScope moves focus into the dialog.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      opener.current = focusOpener(document.activeElement);
      return;
    }
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus();
  }, [open]);
}
