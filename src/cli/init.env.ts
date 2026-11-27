// init step 5 `.env` (PLAN/07 §4.1, §4.3, D7, K10, K17): creates ~/panel/.env from the env schema, asks only the
// required values that are empty or an old placeholder, and writes each answer at once (atomic, mode 600). Existing
// values are never changed. Values are never printed: only names, the redirect URI and a secret's length.
import { chmodSync, statSync } from "node:fs";
import { EnvError, parseEnv } from "../server/env";
import { readTextOrNull, writeAtomic } from "../server/sites/site.files";
import { EMAIL_RE, HOSTNAME_RE } from "../shared/address.rules";
import { decodeEnvValue, encodeEnvLine, envValueProblem, findEnvLine } from "../shared/env.codec";
import { ENV_VARS, type EnvVar, type EnvVarName, isEnvValueMissing, renderEnvTemplate } from "../shared/env.schema";
import { probePaths } from "./cli.host";
import { activeCliLocale, tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { defineStep, INIT_EXIT, type InitContext, type PlanLine } from "./init.types";

const ENV_MODE = 0o600;
// §4.3 question order (address and email first, then Google with the redirect URI built from the address); the
// schema order puts the Google pair before the email
const ASK_ORDER: readonly EnvVarName[] = [
  "APP_BASE_URL",
  "SUPER_ADMIN_EMAILS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];
const REQUIRED: readonly EnvVar[] = ASK_ORDER.map((name) => ENV_VARS.find((v) => v.name === name) as EnvVar);
const DEFAULT_PORT = ENV_VARS.find((v) => v.name === "PORT")?.default;

/** What detect found: file text (null = absent), required names still missing, flag prefills, parseEnv error. */
export type EnvStepState = {
  file: string;
  text: string | null;
  wideMode: boolean;
  missing: EnvVarName[];
  fill: Partial<Record<EnvVarName, string>>;
  invalid: string | null;
};

/** `panel.contoh.com`, `https://Panel.contoh.com/` → `panel.contoh.com`; null when not a valid hostname. */
export function normalizeHostname(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return HOSTNAME_RE.test(host) ? host : null;
}

/** Comma-separated emails trimmed and lowercased; null when empty or one is not an email. */
export function normalizeEmails(input: string): string | null {
  const list = input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 && list.every((e) => EMAIL_RE.test(e)) ? list.join(",") : null;
}

/** `text` with the last `key=` line (the one Bun reads) replaced by `key=value`, or the line appended. */
export function setEnvLine(text: string, key: string, value: string): string {
  const lines = text.split("\n");
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const i = lines.findLastIndex((l) => re.test(l));
  const line = encodeEnvLine(key, value);
  if (i >= 0) lines[i] = line;
  else if (lines.at(-1) === "") lines.splice(-1, 0, line);
  else lines.push(line);
  return lines.join("\n");
}

const envValue = (text: string | null, name: string) => {
  const raw = text === null ? null : findEnvLine(text, name);
  return raw === null ? undefined : decodeEnvValue(raw);
};

/** parseEnv's message for the file's values (names a variable, never a value), or null when valid. */
function envError(text: string): string | null {
  const values: Record<string, string | undefined> = {};
  for (const v of ENV_VARS) values[v.name] = envValue(text, v.name);
  try {
    parseEnv(values);
    return null;
  } catch (e) {
    if (e instanceof EnvError) return e.message;
    throw e;
  }
}

const usage = (message: string) =>
  new CliExit(INIT_EXIT.usage, message, tr("see: panel init --help", "lihat: panel init --help"));

/** Values the flags give for missing variables (§4.3: --hostname, --admin-email, --skip tunnel → localhost). */
function prefill(ctx: InitContext, text: string | null): EnvStepState["fill"] {
  const { args } = ctx;
  const fill: EnvStepState["fill"] = {};
  if (args.skip.has("tunnel")) fill.APP_BASE_URL = `http://localhost:${envValue(text, "PORT") || DEFAULT_PORT}`;
  else if (args.hostname !== null) {
    const host = normalizeHostname(args.hostname);
    if (host === null)
      throw usage(
        tr(
          "--hostname is not a valid address (example: panel.example.com)",
          "--hostname bukan alamat yang valid (contoh: panel.contoh.com)",
        ),
      );
    fill.APP_BASE_URL = `https://${host}`;
  }
  if (args.adminEmails.length > 0) {
    const emails = normalizeEmails(args.adminEmails.join(","));
    if (emails === null)
      throw usage(
        tr(
          "--admin-email holds an email address that is not valid",
          "--admin-email berisi alamat email yang tidak valid",
        ),
      );
    fill.SUPER_ADMIN_EMAILS = emails;
  }
  return fill;
}

async function detect(ctx: InitContext): Promise<EnvStepState> {
  const file = probePaths(ctx.host.paths).envFile;
  const text = readTextOrNull(file);
  const missing = REQUIRED.filter((v) => isEnvValueMissing(v, envValue(text, v.name))).map((v) => v.name as EnvVarName);
  return {
    file,
    text,
    wideMode: text !== null && (statSync(file).mode & 0o777) !== ENV_MODE,
    missing,
    fill: prefill(ctx, text),
    invalid: text !== null && missing.length === 0 ? envError(text) : null,
  };
}

const shown = (ctx: InitContext, file: string) => file.replace(ctx.host.paths.home, "~");

function plan(ctx: InitContext, s: EnvStepState): PlanLine[] {
  const name = shown(ctx, s.file);
  const lines: PlanLine[] = [];
  if (s.text === null)
    lines.push({ kind: "action", text: tr(`Creating ${name} (mode 600)`, `Membuat ${name} (izin 600)`) });
  else if (s.wideMode)
    lines.push({
      kind: "action",
      text: tr(`Setting the mode of ${name} to 600`, `Mengatur izin ${name} menjadi 600`),
    });
  if (s.missing.length > 0) {
    const names = s.missing.join(", ");
    lines.push({ kind: "action", text: tr(`Filling in ${name}: ${names}`, `Mengisi ${name}: ${names}`) });
    const unanswered = s.missing.filter((n) => s.fill[n] === undefined).join(", ");
    if (!ctx.tty && unanswered)
      lines.push({
        kind: "warning",
        text: tr(
          `Without a terminal, ${unanswered} cannot be asked`,
          `Tanpa terminal, ${unanswered} tidak bisa ditanyakan`,
        ),
        hint: tr(`run ${ctx.resumeCommand()} in a terminal`, `jalankan ${ctx.resumeCommand()} di terminal`),
      });
  }
  if (s.invalid !== null) lines.push({ kind: "error", text: invalidText(s.invalid), hint: fixHint(name) });
  return lines;
}

const invalidText = (why: string) => tr(`.env is not valid: ${why}`, `.env tidak valid: ${why}`);
const fixHint = (where: string) => tr(`fix the value in ${where}`, `perbaiki nilainya di ${where}`);

const GOOGLE_BLOCK = (baseUrl: string) => [
  tr(
    'Create a Google OAuth client (type "Web application") at console.cloud.google.com → APIs & Services → Credentials.',
    'Buat OAuth client Google (tipe "Web application") di console.cloud.google.com → APIs & Services → Credentials.',
  ),
  tr('Paste this address under "Authorized redirect URIs":', 'Tempel alamat ini di "Authorized redirect URIs":'),
  `  ${baseUrl.replace(/\/+$/, "")}/api/auth/callback/google`,
  tr("Guide: panel docs google", "Panduan: panel docs google"),
];

/** Asks one variable until the answer is valid; null = EOF. Never echoes or prints the secret. */
async function askValue(ctx: InitContext, name: EnvVarName): Promise<string | null> {
  const { prompt, out } = ctx;
  for (;;) {
    let answer: string | null;
    let value: string | null;
    if (name === "APP_BASE_URL") {
      answer = await prompt.ask(tr("Panel address (e.g. panel.example.com):", "Alamat panel (mis. panel.contoh.com):"));
      const host = answer === null ? null : normalizeHostname(answer);
      value = host && `https://${host}`;
      if (answer !== null && !host)
        out.note(
          tr(
            "❌ That is not a valid address. Example: panel.example.com",
            "❌ Itu bukan alamat yang valid. Contoh: panel.contoh.com",
          ),
        );
    } else if (name === "SUPER_ADMIN_EMAILS") {
      answer = await prompt.ask(
        tr("Google email of the panel owner (super admin):", "Email Google pemilik panel (super admin):"),
      );
      value = answer === null ? null : normalizeEmails(answer);
      if (answer !== null && !value)
        out.note(
          tr(
            "❌ Not a valid email. Separate several emails with commas.",
            "❌ Email tidak valid. Beberapa email pisahkan dengan koma.",
          ),
        );
    } else {
      const secret = name === "GOOGLE_CLIENT_SECRET";
      answer = await (secret ? prompt.secret("Client secret:") : prompt.ask("Client ID:"));
      value = answer?.trim() || null;
      if (answer !== null && !value) out.note(tr("❌ Cannot be empty.", "❌ Tidak boleh kosong."));
    }
    if (answer === null) return null;
    if (value === null) continue;
    if (envValueProblem(value) !== null) {
      out.note(
        tr(
          "❌ This value cannot be stored in .env (too long, or it holds quotes/new lines).",
          "❌ Nilai ini tidak bisa disimpan di .env (terlalu panjang atau berisi tanda kutip/baris baru).",
        ),
      );
      continue;
    }
    if (name === "GOOGLE_CLIENT_SECRET")
      out.line(tr(`(saved, ${value.length} characters)`, `(tersimpan, ${value.length} karakter)`));
    return value;
  }
}

async function apply(ctx: InitContext, s: EnvStepState): Promise<void> {
  let text = s.text ?? renderEnvTemplate({ full: true, locale: activeCliLocale().locale });
  const save = () => {
    writeAtomic(s.file, text, { mode: ENV_MODE });
    if (!ctx.state.changed.includes(s.file)) ctx.state.changed.push(s.file);
  };
  if (s.text === null) save();
  else if (s.wideMode) {
    chmodSync(s.file, ENV_MODE);
    ctx.state.changed.push(s.file);
  }
  const left: EnvVarName[] = [];
  let googleShown = false;
  for (const name of s.missing) {
    let value = s.fill[name] ?? null;
    if (value === null && ctx.tty && left.length === 0) {
      if (name.startsWith("GOOGLE_") && !googleShown) {
        googleShown = true;
        for (const l of GOOGLE_BLOCK(envValue(text, "APP_BASE_URL") ?? "")) ctx.out.line(l);
      }
      value = await askValue(ctx, name);
    }
    if (value === null) {
      left.push(name); // no terminal, or EOF: the rest stays empty, `down` keeps the panel off (§4.3)
      continue;
    }
    text = setEnvLine(text, name, value);
    save();
  }
  const where = shown(ctx, s.file);
  if (left.length > 0)
    throw new CliExit(
      INIT_EXIT.needsUser,
      tr(`${where} is not complete: ${left.join(", ")}.`, `${where} belum lengkap: ${left.join(", ")}.`),
      tr(
        `run ${ctx.resumeCommand()} in a terminal (ssh: use -t), or fill in the values in ${where}`,
        `jalankan ${ctx.resumeCommand()} di terminal (ssh: pakai -t), atau isi nilainya di ${where}`,
      ),
    );
  const invalid = envError(text);
  if (invalid !== null) throw new CliExit(INIT_EXIT.failed, invalidText(invalid), fixHint(where));
}

/** Step 5 `.env`. */
export const envStep = defineStep<EnvStepState>({ id: "env", detect, plan, apply });
