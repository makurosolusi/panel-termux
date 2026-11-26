// "Tempel .env" (PLAN/03 §5.6): parse pasted text with the shared Bun codec into a preview, then merge into the draft.
import { decodeEnvValue, envValueProblem, expandsVariable } from "@/shared/env.codec";
import { ENV_KEY_RE } from "@/shared/site.types";
import { type EnvDraft, newEnvRow } from "./env.rows";

/** What is wrong (or worth knowing) about one pasted line; `pm2` and `dollar` do not block applying it. */
export type PasteProblem = "invalid" | "locked" | "pm2" | "duplicate" | "multiline" | "quote" | "too_long" | "dollar";

/** One `KEY=value` line of the paste; `action: "skip"` lines are not applied. */
export type PasteEntry = {
  line: number;
  key: string;
  value: string;
  action: "new" | "replace" | "skip";
  problems: PasteProblem[];
};

const BLOCKING: ReadonlySet<PasteProblem> = new Set([
  "invalid",
  "locked",
  "duplicate",
  "multiline",
  "quote",
  "too_long",
]);
const LINE = /^\s*(?:export\s+)?([^=\s]+)\s*=(.*)$/;
const QUOTES = new Set(["'", '"', "`"]);

/** Quote char a raw value opens without closing on the same line (Bun then reads following lines), else null. */
function openQuote(raw: string): string | null {
  const s = raw.trimStart();
  const q = s[0] ?? "";
  if (!QUOTES.has(q)) return null;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === q) return null;
  }
  return q;
}

/** Preview rows of a pasted `.env`. Blank and `#` lines are skipped; for repeated keys the last line wins. */
export function parseEnvPaste(
  text: string,
  ctx: { existing: readonly string[]; locked: readonly string[]; pm2: readonly string[] },
): PasteEntry[] {
  const entries: PasteEntry[] = [];
  const lines = text.split("\n");
  let quote: string | null = null; // inside a multi-line value: skip its continuation lines
  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/\r$/, "");
    if (quote) {
      if (line.includes(quote)) quote = null;
      return;
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) return;
    const m = LINE.exec(line);
    if (!m) {
      entries.push({ line: i + 1, key: "", value: "", action: "skip", problems: ["invalid"] });
      return;
    }
    const key = m[1] ?? "";
    const raw = m[2] ?? "";
    const problems: PasteProblem[] = [];
    if (!ENV_KEY_RE.test(key)) problems.push("invalid");
    else if (ctx.locked.includes(key)) problems.push("locked");
    else if (ctx.pm2.includes(key)) problems.push("pm2");
    quote = openQuote(raw);
    const value = quote ? "" : decodeEnvValue(raw);
    const valueProblem = quote ? "multiline" : envValueProblem(value);
    if (valueProblem) problems.push(valueProblem);
    if (expandsVariable(raw)) problems.push("dollar");
    entries.push({ line: i + 1, key, value, action: "new", problems });
  });
  const lastIndex = new Map(entries.map((e, i) => [e.key, i]));
  return entries.map((e, i) => {
    const problems = e.key && lastIndex.get(e.key) !== i ? [...e.problems, "duplicate" as const] : e.problems;
    const blocked = problems.some((p) => BLOCKING.has(p));
    return { ...e, problems, action: blocked ? "skip" : ctx.existing.includes(e.key) ? "replace" : "new" };
  });
}

/** Number of preview rows that will be applied. */
export const pasteApplicable = (entries: readonly PasteEntry[]): number =>
  entries.filter((e) => e.action !== "skip").length;

/** Merges applicable entries into the draft: existing keys get a replacement (and stop being unset), others a row. */
export function applyPaste(draft: EnvDraft, entries: readonly PasteEntry[]): EnvDraft {
  const replaced = { ...draft.replaced };
  const unset = new Set(draft.unset);
  let rows = [...draft.rows];
  for (const e of entries) {
    if (e.action === "skip") continue;
    if (e.action === "replace") {
      replaced[e.key] = e.value;
      unset.delete(e.key);
    } else if (rows.some((r) => r.key.trim() === e.key)) {
      rows = rows.map((r) => (r.key.trim() === e.key ? { ...r, value: e.value } : r));
    } else {
      rows = [...rows.filter((r) => r.key !== "" || r.value !== ""), newEnvRow(e.key, e.value)];
    }
  }
  return { replaced, unset, rows };
}
