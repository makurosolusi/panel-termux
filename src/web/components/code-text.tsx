import type { ReactNode } from "react";

/** Copy split on backticks: odd segments are code. Unbalanced backticks → the whole text as plain (no guessing). */
export function codeSegments(text: string): { text: string; code: boolean }[] {
  const parts = text.split("`");
  if (parts.length % 2 === 0) return [{ text, code: false }];
  return parts.map((s, i) => ({ text: s, code: i % 2 === 1 })).filter((s) => s.text !== "");
}

/**
 * Renders `code` spans of i18n copy (help, error detail, descriptions) as <code>; non-string children pass through.
 * Plain counterpart of InlineCode (no copy button), small enough for the initial bundle.
 */
export function CodeText({ children }: { children: ReactNode }) {
  if (typeof children !== "string" || !children.includes("`")) return children;
  return codeSegments(children).map((s, i) =>
    s.code ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments of one immutable string, order never changes
      <code key={i} className="rounded bg-muted px-1 py-px font-mono text-[0.8125em] break-all">
        {s.text}
      </code>
    ) : (
      s.text
    ),
  );
}
