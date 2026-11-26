/**
 * 44 px hit area for small inline links under a coarse pointer (WCAG 2.5.5) without changing the layout: an
 * invisible ::after centred on the link, at least 44 px tall and wide whatever the text size (16 px text with a fixed
 * -12 px inset gave 40 px, QA #5), and 12 px wider each side for longer labels. The element must not clip overflow.
 */
export const TOUCH_HIT =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-[max(12px,calc(22px_-_50%))] pointer-coarse:after:-inset-y-[max(0px,calc(22px_-_50%))] pointer-coarse:after:content-['']";
