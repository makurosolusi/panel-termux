// `panel docs [topic]` (PLAN/07 §6.1, PLAN/08 §6): short guides embedded as text so they work offline; plain text,
// no ANSI. English at docs/cli/<topic>.md, Indonesian at docs/cli/id/<topic>.md, picked by the CLI locale.
import ANDROID from "../../docs/cli/android.md" with { type: "text" };
import CLOUDFLARE from "../../docs/cli/cloudflare.md" with { type: "text" };
import GOOGLE from "../../docs/cli/google.md" with { type: "text" };
import ID_ANDROID from "../../docs/cli/id/android.md" with { type: "text" };
import ID_CLOUDFLARE from "../../docs/cli/id/cloudflare.md" with { type: "text" };
import ID_GOOGLE from "../../docs/cli/id/google.md" with { type: "text" };
import ID_PACKAGES from "../../docs/cli/id/packages.md" with { type: "text" };
import PACKAGES from "../../docs/cli/packages.md" with { type: "text" };
import type { Locale } from "../shared/locale";
import { activeCliLocale, tr } from "./cli.locale";
import type { Command } from "./cli.main";
import { CliExit } from "./cli.output";

/** Folder of the same guides on GitHub (README links it instead of copying them). */
export const DOCS_URL = "https://github.com/makurosolusi/panel-termux/tree/main/docs/cli";

type Topic = { summary: Record<Locale, string>; text: Record<Locale, string> };

/** The 4 topics (C12), in list order: name → one-line summary and embedded markdown per locale. */
export const DOC_TOPICS: Record<string, Topic> = {
  google: {
    summary: { en: "Google sign-in: OAuth client and redirect URI", id: "Login Google: OAuth client dan redirect URI" },
    text: { en: GOOGLE, id: ID_GOOGLE },
  },
  cloudflare: {
    summary: {
      en: "Cloudflare Tunnel: login, tunnel, DNS, Access",
      id: "Cloudflare Tunnel: login, tunnel, DNS, Access",
    },
    text: { en: CLOUDFLARE, id: ID_CLOUDFLARE },
  },
  android: {
    summary: {
      en: "Termux, Termux:Boot, Termux:API, battery, wake-lock",
      id: "Termux, Termux:Boot, Termux:API, baterai, wake-lock",
    },
    text: { en: ANDROID, id: ID_ANDROID },
  },
  packages: {
    summary: {
      en: "Upgrading the held cloudflared and PostgreSQL safely",
      id: "Upgrade aman cloudflared dan PostgreSQL yang ditahan",
    },
    text: { en: PACKAGES, id: ID_PACKAGES },
  },
};

/** Old topic names still accepted (0.5.x printed `panel docs paket`). */
export const DOC_ALIASES: Record<string, string> = { paket: "packages" };

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

/** `panel docs` lists the topics; `panel docs <topic>` prints one; unknown topic → exit 2 with the list. */
export const docsCommand: Command = async ({ positionals }, { out }) => {
  const { locale } = activeCliLocale();
  const names = Object.keys(DOC_TOPICS);
  const [topic] = positionals;
  if (topic === undefined) {
    out.line(tr("Guide topics:", "Topik panduan:"));
    for (const name of names) out.line(`  ${name.padEnd(12)}${DOC_TOPICS[name]?.summary[locale]}`);
    out.line();
    out.line(tr("Read one topic: panel docs <topic>", "Baca satu topik: panel docs <topik>"));
    out.line(`${tr("Web version", "Versi web")}: ${DOCS_URL}`);
    return 0;
  }
  const doc = DOC_TOPICS[DOC_ALIASES[topic] ?? topic];
  if (!doc)
    throw new CliExit(
      USAGE,
      tr(`Unknown topic: ${topic}`, `Topik tidak dikenal: ${topic}`),
      `${tr("topics", "topik")}: ${names.join(", ")}`,
    );
  out.line(renderPlain(doc.text[locale]));
  return 0;
};
