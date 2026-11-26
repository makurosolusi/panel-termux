// Server-side log redaction (PLAN/02 §5.8, B22): masks common secret shapes before a log line leaves the panel.
// Best effort by design (PLAN/02 R2): only known shapes and the caller's exact secret values are caught.

const MASK = "***";
/** Exact secret values shorter than this are not masked (a 1-3 character value would mask ordinary text). */
export const MIN_SECRET_LENGTH = 4;

type Pattern = { re: RegExp; to: (m: string, ...g: string[]) => string };

const PATTERNS: Pattern[] = [
  // scheme://user:pass@host (database URLs, https basic auth, …)
  { re: /\b([a-z][a-z0-9+.-]*):\/\/[^:/\s@]+:[^@\s]+@/gi, to: (_m, scheme) => `${scheme}://${MASK}:${MASK}@` },
  // Authorization header values, with or without an auth scheme word
  {
    re: /(authorization["']?\s*[:=]\s*["']?)(?:(bearer|basic|token|digest)\s+)?[^\s"',}]+/gi,
    to: (_m, head, scheme) => `${head}${scheme ? `${scheme} ` : ""}${MASK}`,
  },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, to: () => `Bearer ${MASK}` },
  // key=value / "key": "value" where the key names a secret (tokenizer and friends are not followed by = or :)
  {
    re: /(["']?)([a-z0-9_]*(?:token|secret|password|passwd|api_?key|private_?key|access_?key)[a-z0-9_]*)\1(\s*[=:]\s*)(["']?)[^"'\s,}]+\4/gi,
    to: (_m, q, key, sep, vq) => `${q}${key}${q}${sep}${vq}${MASK}${vq}`,
  },
  // Telegram bot token shape; no leading \b, URLs glue it to "bot" (…/bot123:AA…/sendMessage)
  { re: /(?<!\d)\d{6,16}:[A-Za-z0-9_-]{30,}/g, to: () => MASK },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Redacted lines plus how many values were masked (for "Disamarkan: n nilai rahasia", PLAN/03). */
export type RedactedLines = { lines: string[]; redacted: number };

/**
 * Masks env values (`extraSecrets`, e.g. a site's `.env` values), bearer/bot tokens, Authorization headers,
 * secret-named key/value pairs and URLs with credentials. Longest secrets first so a prefix never leaks a tail.
 */
export function redactLines(lines: string[], extraSecrets: Iterable<string> = []): RedactedLines {
  const exact = [...new Set(extraSecrets)]
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  const exactRe = exact.length ? new RegExp(exact.map(escapeRe).join("|"), "g") : null;
  let redacted = 0;
  const out = lines.map((line) => {
    let text = exactRe
      ? line.replace(exactRe, () => {
          redacted++;
          return MASK;
        })
      : line;
    for (const { re, to } of PATTERNS) {
      text = text.replace(re, (...args: string[]) => {
        const replaced = to(...(args as [string, ...string[]]));
        if (replaced !== args[0]) redacted++;
        return replaced;
      });
    }
    return text;
  });
  return { lines: out, redacted };
}
