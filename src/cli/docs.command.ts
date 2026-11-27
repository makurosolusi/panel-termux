// `panel docs [topik]` (PLAN/07 §6.1): short guides embedded as text so they work offline; plain text, no ANSI.
// @ts-expect-error TS2307: Bun embeds .md as text (`type: "text"`); tsc has no `*.md` module declaration.
import ANDROID from "../../docs/cli/android.md" with { type: "text" };
// @ts-expect-error TS2307: same embedded markdown import as above.
import CLOUDFLARE from "../../docs/cli/cloudflare.md" with { type: "text" };
// @ts-expect-error TS2307: same embedded markdown import as above.
import GOOGLE from "../../docs/cli/google.md" with { type: "text" };
// @ts-expect-error TS2307: same embedded markdown import as above.
import PAKET from "../../docs/cli/paket.md" with { type: "text" };
import type { Command } from "./cli.main";
import { CliExit } from "./cli.output";

/** Folder of the same guides on GitHub (README links it instead of copying them). */
export const DOCS_URL = "https://github.com/makurosolusi/panel-termux/tree/main/docs/cli";

/** The 4 topics (C12), in list order: name → one-line summary and embedded markdown. */
export const DOC_TOPICS: Record<string, { summary: string; text: string }> = {
  google: { summary: "Login Google: OAuth client dan redirect URI", text: GOOGLE },
  cloudflare: { summary: "Cloudflare Tunnel: login, tunnel, DNS, Access", text: CLOUDFLARE },
  android: { summary: "Termux, Termux:Boot, Termux:API, baterai, wake-lock", text: ANDROID },
  paket: { summary: "Upgrade aman cloudflared dan PostgreSQL yang ditahan", text: PAKET },
};

const USAGE = 2;
const FENCE = /^\s*```/;

/** Markdown → plain terminal text: no `#`, `**` or backticks; fenced code indented 4 spaces. */
export function renderPlain(markdown: string): string {
  let code = false;
  const lines: string[] = [];
  for (const line of markdown.trimEnd().split("\n")) {
    if (FENCE.test(line)) {
      code = !code;
      continue;
    }
    if (code) lines.push(`    ${line}`);
    else
      lines.push(
        line
          .replace(/^#+\s+/, "")
          .replaceAll("**", "")
          .replaceAll("`", ""),
      );
  }
  return lines.join("\n");
}

/** `panel docs` lists the topics; `panel docs <topik>` prints one; unknown topic → exit 2 with the list. */
export const docsCommand: Command = async ({ positionals }, { out }) => {
  const names = Object.keys(DOC_TOPICS);
  const [topic] = positionals;
  if (topic === undefined) {
    out.line("Topik panduan:");
    for (const name of names) out.line(`  ${name.padEnd(12)}${DOC_TOPICS[name]?.summary}`);
    out.line();
    out.line("Baca satu topik: panel docs <topik>");
    out.line(`Versi web: ${DOCS_URL}`);
    return 0;
  }
  const doc = DOC_TOPICS[topic];
  if (!doc) throw new CliExit(USAGE, `Topik tidak dikenal: ${topic}`, `topik: ${names.join(", ")}`);
  out.line(renderPlain(doc.text));
  return 0;
};
