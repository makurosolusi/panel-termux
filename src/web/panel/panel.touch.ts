/**
 * 44 px hit area for small inline links under a coarse pointer (WCAG 2.5.5) without changing the layout:
 * an invisible ::after grows the target 12 px each way (20 px line → 44 px). The element must not clip overflow.
 */
export const TOUCH_HIT =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']";
