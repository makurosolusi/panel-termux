import { useLayoutEffect, useRef } from "react";

/**
 * Returns focus to the element that was focused when `open` turned true, once it turns false again. Radix restores
 * focus only to its own Trigger, so dialogs opened by state (row buttons, menus) otherwise leave focus on <body>.
 * Layout effect: it runs before Radix's FocusScope moves focus into the dialog.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus(); // a menu item that opened the dialog is gone by now: nothing to return to
  }, [open]);
}
