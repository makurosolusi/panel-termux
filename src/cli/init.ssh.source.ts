// `--ssh-key` source of step 3a `ssh` (split from init.ssh.ts): https URL (redirects must stay https), `-` (one
// pasted line) or a local file, read once per init run.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { type PublicKey, parseKeys } from "./init.ssh.keys";
import { INIT_EXIT, type InitContext } from "./init.types";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCE_CHARS = 100_000; // a GitHub .keys page is a few hundred bytes per key

/** Reads the `--ssh-key` source: https URL (fetch), `-` (one line from the terminal/stdin), or a local file. */
async function readSource(ctx: InitContext, src: string): Promise<{ text: string; label: string }> {
  if (src === "-") {
    const line = await ctx.prompt.ask(tr("Paste one public key line:", "Tempel satu baris kunci publik:"));
    if (line === null || line.trim() === "")
      throw new CliExit(
        INIT_EXIT.needsUser,
        tr("--ssh-key -: no key was pasted.", "--ssh-key -: tidak ada kunci yang ditempel."),
        tr("paste one key line", "tempel satu baris kunci"),
      );
    return { text: line, label: tr("the pasted key", "kunci yang ditempel") };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) {
    if (!/^https:\/\//i.test(src))
      throw new CliExit(
        INIT_EXIT.usage,
        tr("--ssh-key only accepts https:// URLs.", "--ssh-key hanya menerima URL https://."),
        tr("example: https://github.com/<account>.keys", "contoh: https://github.com/<akun>.keys"),
      );
    let res: Response;
    try {
      res = await ctx.host.fetch(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      const why = (e as Error).message;
      throw new CliExit(
        INIT_EXIT.failed,
        tr(`Could not download keys from ${src}: ${why}`, `Gagal mengunduh kunci dari ${src}: ${why}`),
        tr("check the internet", "cek internet"),
      );
    }
    // fetch follows redirects: a hop to http:// would hand us keys anyone on the path could have swapped
    if (!/^https:\/\//i.test(res.url || src))
      throw new CliExit(
        INIT_EXIT.failed,
        tr(
          `${src} redirected to an address that is not https; the keys are not used.`,
          `${src} dialihkan ke alamat yang bukan https; kunci tidak dipakai.`,
        ),
      );
    if (!res.ok)
      throw new CliExit(
        INIT_EXIT.failed,
        tr(
          `Could not download keys from ${src}: HTTP ${res.status}.`,
          `Gagal mengunduh kunci dari ${src}: HTTP ${res.status}.`,
        ),
      );
    const text = await res.text();
    if (text.length > MAX_SOURCE_CHARS)
      throw new CliExit(
        INIT_EXIT.failed,
        tr(`${src} is too large for a key list.`, `${src} terlalu besar untuk daftar kunci.`),
      );
    return { text, label: src };
  }
  const file = resolve(src);
  try {
    return { text: readFileSync(file, "utf8"), label: file };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
    throw new CliExit(
      INIT_EXIT.failed,
      tr(`Could not read the key file ${file}: ${code}.`, `Gagal membaca file kunci ${file}: ${code}.`),
    );
  }
}

// detect runs twice (plan, then before apply): read the source once per run, so `-` asks once and a URL is fetched once
const sourceCache = new WeakMap<InitContext, Promise<PublicKey[]>>();
/** Public keys of the `--ssh-key` source, read once per init run. */
export const loadKeys = (ctx: InitContext, src: string) => {
  let p = sourceCache.get(ctx);
  if (!p) {
    p = readSource(ctx, src).then(({ text, label }) => parseKeys(text, label));
    sourceCache.set(ctx, p);
  }
  return p;
};
