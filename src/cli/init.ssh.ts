// Step 3a `ssh` (PLAN/07 §4.1, K22, C26, E12): only with `--ssh-key <https-url|file|->`. Adds public keys to
// ~/.ssh/authorized_keys (no duplicates, tmp + rename), a key-only sshd drop-in when the config allows one, and
// starts sshd under runit, right after runit and before the risky steps, so ssh works again early on a wiped phone.
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext, type PlanLine } from "./init.types";

/** Termux sshd's port (openssh package default). */
export const SSHD_PORT = 8022;
/** Our drop-in (K22); written only when absent and sshd_config includes sshd_config.d. */
export const DROP_IN_NAME = "10-key-only.conf";
const DROP_IN = "# panel init --ssh-key: masuk hanya dengan kunci (PLAN/07 K22)\nPasswordAuthentication no\n";
/** Key types accepted at the start of a line (K22); a line starting with options (`command=` …) is refused. */
export const KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCE_CHARS = 100_000; // a GitHub .keys page is a few hundred bytes per key
const PASTE_PROMPT = "Tempel satu baris kunci publik:";

/** One public key: `type base64 [comment]`; `id` = `type base64` (duplicate check), `fingerprint` as ssh-keygen -l. */
export type PublicKey = { type: string; id: string; line: string; fingerprint: string };

/** SHA256 fingerprint of a key blob, exactly as `ssh-keygen -l` prints it. */
export const fingerprintOf = (blob: Buffer) =>
  `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;

/** Parses one `type base64 [comment]` line; null when it is not a well-formed public key (blob must name its type). */
export function parseKey(line: string): PublicKey | null {
  const [type = "", b64 = ""] = line.trim().split(/\s+/);
  if (!KEY_TYPES.has(type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const blob = Buffer.from(b64, "base64");
  const len = blob.length >= 4 ? blob.readUInt32BE(0) : -1;
  if (len !== type.length || blob.subarray(4, 4 + len).toString("latin1") !== type) return null;
  return { type, id: `${type} ${b64}`, line: line.trim(), fingerprint: fingerprintOf(blob) };
}

/** Every key of a source text (blank and `#` lines skipped); any other line is an error naming its number, not its text. */
export function parseKeys(text: string, source: string): PublicKey[] {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))
    throw new CliExit(INIT_EXIT.failed, `${source} berisi kunci PRIVAT, bukan kunci publik.`, "pakai file .pub");
  const keys: PublicKey[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const key = parseKey(line);
    if (!key)
      throw new CliExit(
        INIT_EXIT.failed,
        `${source} baris ${i + 1} bukan kunci publik SSH (harus diawali ssh-ed25519, ssh-rsa, ecdsa-sha2-… atau sk-…).`,
        "baris yang diawali opsi seperti command= tidak diterima",
      );
    if (!keys.some((k) => k.id === key.id)) keys.push(key);
  }
  if (keys.length === 0) throw new CliExit(INIT_EXIT.failed, `${source} tidak berisi kunci publik.`);
  return keys;
}

/** `type base64` of every key already in authorized_keys (options before the type are allowed there). */
export function existingKeyIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    const t = line.trim().split(/\s+/);
    const i = t.findIndex((tok) => KEY_TYPES.has(tok));
    if (i >= 0 && t[i + 1]) ids.add(`${t[i]} ${t[i + 1]}`);
  }
  return ids;
}

/** authorized_keys after adding `keys`: old lines kept, a missing final newline added first, one line per key. */
export function appendKeys(existing: string, keys: readonly PublicKey[]): string {
  const head = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return head + keys.map((k) => `${k.line}\n`).join("");
}

/** Reads the `--ssh-key` source: https URL (fetch), `-` (one line from the terminal/stdin), or a local file. */
async function readSource(ctx: InitContext, src: string): Promise<{ text: string; label: string }> {
  if (src === "-") {
    const line = await ctx.prompt.ask(PASTE_PROMPT);
    if (line === null || line.trim() === "")
      throw new CliExit(INIT_EXIT.needsUser, "--ssh-key -: tidak ada kunci yang ditempel.", "tempel satu baris kunci");
    return { text: line, label: "kunci yang ditempel" };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) {
    if (!/^https:\/\//i.test(src))
      throw new CliExit(
        INIT_EXIT.usage,
        "--ssh-key hanya menerima URL https://.",
        "contoh: https://github.com/<akun>.keys",
      );
    let res: Response;
    try {
      res = await ctx.host.fetch(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      throw new CliExit(INIT_EXIT.failed, `Gagal mengunduh kunci dari ${src}: ${(e as Error).message}`, "cek internet");
    }
    if (!res.ok) throw new CliExit(INIT_EXIT.failed, `Gagal mengunduh kunci dari ${src}: HTTP ${res.status}.`);
    const text = await res.text();
    if (text.length > MAX_SOURCE_CHARS) throw new CliExit(INIT_EXIT.failed, `${src} terlalu besar untuk daftar kunci.`);
    return { text, label: src };
  }
  const file = resolve(src);
  try {
    return { text: readFileSync(file, "utf8"), label: file };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
    throw new CliExit(INIT_EXIT.failed, `Gagal membaca file kunci ${file}: ${code}.`);
  }
}

// detect runs twice (plan, then before apply): read the source once per run, so `-` asks once and a URL is fetched once
const sourceCache = new WeakMap<InitContext, Promise<PublicKey[]>>();
const loadKeys = (ctx: InitContext, src: string) => {
  let p = sourceCache.get(ctx);
  if (!p) {
    p = readSource(ctx, src).then(({ text, label }) => parseKeys(text, label));
    sourceCache.set(ctx, p);
  }
  return p;
};

/** Paths of the step, from the host's HOME/PREFIX/SVDIR. */
export function sshPaths(ctx: InitContext) {
  const { home, prefix, svdir } = ctx.host.paths;
  const etc = join(prefix, "etc", "ssh");
  return {
    sshDir: join(home, ".ssh"),
    authorizedKeys: join(home, ".ssh", "authorized_keys"),
    sshdConfig: join(etc, "sshd_config"),
    dropInDir: join(etc, "sshd_config.d"),
    dropIn: join(etc, "sshd_config.d", DROP_IN_NAME),
    hostKey: join(etc, "ssh_host_ed25519_key.pub"),
    service: join(svdir, "sshd"),
    down: join(svdir, "sshd", "down"),
  };
}

/**
 * Drop-in decision (K22, E12): `write` only when ours is absent, sshd_config includes sshd_config.d and nobody set
 * PasswordAuthentication; sshd_config itself is never edited. `no-config` = openssh not installed yet (decided again
 * before apply, after the package step).
 */
export type DropIn = "write" | "exists" | "user-set" | "no-include" | "no-config";
const readOr = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const SETS_PASSWORD = /^\s*PasswordAuthentication\s/im;

/** Reads sshd_config (+ its drop-ins) to decide the key-only drop-in. */
export function dropInDecision(p: ReturnType<typeof sshPaths>): DropIn {
  if (existsSync(p.dropIn)) return "exists";
  if (!existsSync(p.sshdConfig)) return "no-config";
  const config = readFileSync(p.sshdConfig, "utf8");
  const others = existsSync(p.dropInDir) ? readdirSync(p.dropInDir).map((f) => readOr(join(p.dropInDir, f))) : [];
  if ([config, ...others].some((t) => SETS_PASSWORD.test(t))) return "user-set";
  return /^\s*Include\s+\S*sshd_config\.d\//im.test(config) ? "write" : "no-include";
}

/** What detect found. `upgrade` = step left for a later run (K21: upgrade never touches ssh). */
export type SshState =
  | { upgrade: true }
  | { upgrade: false; keys: PublicKey[]; add: PublicKey[]; dropIn: DropIn; down: boolean; running: boolean };

const detect = async (ctx: InitContext): Promise<SshState> => {
  const src = ctx.args.sshKey;
  if (ctx.mode === "upgrade" || src === null) return { upgrade: true };
  const keys = await loadKeys(ctx, src);
  const p = sshPaths(ctx);
  const have = existingKeyIds(readOr(p.authorizedKeys));
  let running = false;
  if (existsSync(p.service) && existsSync(probePaths(ctx.host.paths).sv))
    running = (await ctx.host.exec("sv", ["status", "sshd"])).stdout.startsWith("run:");
  return {
    upgrade: false,
    keys,
    add: keys.filter((k) => !have.has(k.id)),
    dropIn: dropInDecision(p),
    down: existsSync(p.down),
    running,
  };
};

const plan = (ctx: InitContext, s: SshState): PlanLine[] => {
  if (s.upgrade)
    return ctx.args.sshKey === null
      ? []
      : [
          {
            kind: "warning",
            text: "SSH dilewati saat upgrade",
            hint: `jalankan lagi panel init --ssh-key ${ctx.args.sshKey} setelah upgrade`,
          },
        ];
  const lines: PlanLine[] = [];
  if (s.add.length > 0)
    lines.push({
      kind: "action",
      text: `Tambah ${s.add.length} kunci SSH ke ~/.ssh/authorized_keys: ${s.add.map((k) => k.fingerprint).join(", ")}`,
    });
  else lines.push({ kind: "ok", text: `Kunci SSH sudah terdaftar (${s.keys.length})` });
  if (s.dropIn === "write" || s.dropIn === "no-config")
    lines.push({ kind: "action", text: "Matikan masuk SSH dengan kata sandi (hanya kunci)" });
  if (!s.running) lines.push({ kind: "action", text: `Nyalakan SSH (port ${SSHD_PORT})` });
  return lines;
};

/** Writes authorized_keys via tmp + rename (700 dir, 600 file); returns the touched paths. */
function writeKeys(p: ReturnType<typeof sshPaths>, add: readonly PublicKey[]): string[] {
  const changed: string[] = [];
  if (!existsSync(p.sshDir)) {
    mkdirSync(p.sshDir, { mode: 0o700 });
    chmodSync(p.sshDir, 0o700); // mkdir's mode is masked by umask
    changed.push(p.sshDir);
  }
  const tmp = `${p.authorizedKeys}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, appendKeys(readOr(p.authorizedKeys), add), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, p.authorizedKeys);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new Error(`write ${p.authorizedKeys} failed: ${(e as Error).message}`, { cause: e });
  }
  return [...changed, p.authorizedKeys];
}

const apply = async (ctx: InitContext, s: SshState): Promise<void> => {
  if (s.upgrade) return;
  const { out, state } = ctx;
  const p = sshPaths(ctx);
  if (s.add.length > 0) {
    for (const k of s.add) out.line(`  ${k.fingerprint} (${k.type})`);
    if (ctx.tty && !(await ctx.prompt.confirm(`Tambahkan ${s.add.length} kunci ini?`, true))) {
      out.line("  SSH dilewati: kunci tidak ditambahkan.");
      state.manual.push(`SSH belum disiapkan: jalankan lagi ${ctx.resumeCommand()} --ssh-key <kunci yang benar>`);
      return;
    }
    state.changed.push(...writeKeys(p, s.add));
  }
  if (s.dropIn === "write") {
    mkdirSync(p.dropInDir, { recursive: true });
    writeFileSync(p.dropIn, DROP_IN, { mode: 0o644 });
    state.changed.push(p.dropIn);
    if (s.running)
      state.manual.push("SSH: masuk hanya dengan kunci berlaku setelah sshd dinyalakan ulang (sv restart sshd)");
  } else if (s.dropIn === "no-include" || s.dropIn === "user-set") {
    out.check("info", "Pengaturan sshd tidak diubah (masuk dengan kata sandi diatur sshd_config)");
  }
  if (!s.running) {
    if (!existsSync(p.service))
      throw new CliExit(INIT_EXIT.failed, `Layanan sshd tidak ada di ${p.service}.`, "pasang: pkg install openssh");
    if (s.down) {
      rmSync(p.down, { force: true });
      state.changed.push(p.down);
    }
    const r = await ctx.host.exec("sv", ["up", "sshd"]);
    if (r.code !== 0)
      throw new CliExit(
        INIT_EXIT.failed,
        `Gagal menyalakan sshd: ${r.stderr.trim() || `kode ${r.code}`}.`,
        "sv status sshd",
      );
  }
  const host = existsSync(p.hostKey) ? parseKey(readFileSync(p.hostKey, "utf8")) : null;
  out.check(
    host ? "ok" : "warning",
    host ? `Sidik jari HP (host): ${host.fingerprint}` : "Sidik jari HP belum ada (kunci host sshd belum dibuat)",
  );
  // ponytail: IP is not guessed (K22: no `ip` on POCO, Tailscale vs Wi-Fi differ); the user reads it off the phone
  out.line(`  Masuk dari komputer: ssh -p ${SSHD_PORT} ${userInfo().username}@<IP HP: lihat Tailscale/Wi-Fi>`);
};

/** Step 3a: SSH access from `--ssh-key` (K22, C26). */
export const sshStep = defineStep<SshState>({ id: "ssh", title: INIT_STEP_TITLES.ssh, detect, plan, apply });
