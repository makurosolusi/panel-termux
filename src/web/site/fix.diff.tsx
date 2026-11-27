import type { FixChange, FixFilePreview } from "@/shared/fix.types";
import { tSite } from "@/web/i18n/en.site";

const t = tSite.setup.diff;

/** One rendered diff line: `line` = number in the current file (removed) or after `afterLine` (added). */
export type DiffLine = { sign: "+" | "-"; line: number; text: string };

/** Patcher hunks → lines in file order; added lines are numbered after the line they follow. */
export function diffLines(changes: readonly FixChange[]): DiffLine[] {
  const rows = changes.flatMap((c): (DiffLine & { at: number })[] =>
    c.kind === "remove"
      ? [{ sign: "-", line: c.line, text: c.text, at: c.line }]
      : c.lines.map((text, n) => ({ sign: "+", line: c.afterLine + n + 1, text, at: c.afterLine + 0.5 })),
  );
  // stable sort: a removed line comes before lines added after it
  return rows.sort((a, b) => a.at - b.at).map(({ sign, line, text }) => ({ sign, line, text }));
}

/** Exact change of one file: `+`/`-` lines with numbers, monospace, scrolls sideways (PLAN/06 §4.1). */
export function FixDiff({ file }: { file: FixFilePreview }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <figcaption className="font-mono text-xs break-all text-muted-foreground">{file.path}</figcaption>
      <section className="max-h-72 overflow-auto rounded-md border bg-muted" aria-label={t.label(file.path)}>
        <table className="w-full border-collapse font-mono text-xs leading-relaxed">
          <tbody>
            {diffLines(file.changes).map((l) => (
              <tr key={`${l.sign}${l.line}`} className={l.sign === "+" ? "bg-success-subtle" : "bg-danger-subtle"}>
                <td className="w-10 px-2 text-right text-muted-foreground select-none">{l.line}</td>
                <td className="w-4 select-none">
                  <span aria-hidden>{l.sign}</span>
                  <span className="sr-only">{l.sign === "+" ? t.added : t.removed}</span>
                </td>
                <td className="pr-3 whitespace-pre">{l.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </figure>
  );
}
