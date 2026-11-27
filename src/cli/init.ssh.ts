// Step 3a `ssh` (PLAN/07 §4.1, K22, C26, E12): only with `--ssh-key <https-url|file|->`. Adds public keys to
// ~/.ssh/authorized_keys (no duplicates, tmp + rename), a key-only sshd drop-in when the config allows one, and
// starts sshd under runit, right after runit and before the risky steps, so ssh works again early on a wiped phone.
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
import { basename, join } from "node:path";
import { probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { INIT_TIMING, type InitTiming, sv } from "./init.runit";
import { appendKeys, existingKeyIds, type PublicKey, parseKey } from "./init.ssh.keys";
import { loadKeys } from "./init.ssh.source";
import { defineStep, INIT_EXIT, type InitContext, type PlanLine } from "./init.types";

/** Termux sshd's port (openssh package default). */
export const SSHD_PORT = 8022;
/** Our drop-in (K22); written only when absent and sshd_config includes sshd_config.d. */
export const DROP_IN_NAME = "10-key-only.conf";
// File comment in English for every locale: a config file on the phone, not CLI output.
const DROP_IN = "# panel init --ssh-key: sign-in with a key only (PLAN/07 K22)\nPasswordAuthentication no\n";

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

/**
 * What detect found. `upgrade` = step left for a later run (K21: upgrade never touches ssh). `manual` = pid of an
 * sshd started by hand (not under runit, e.g. from ~/.bashrc): it holds port 8022, so `sv up` would crash-loop.
 */
export type SshState =
  | { upgrade: true }
  | {
      upgrade: false;
      keys: PublicKey[];
      add: PublicKey[];
      dropIn: DropIn;
      down: boolean;
      running: boolean;
      manual: number | null;
    };

/** Our own sshd process outside runit (only asked when runit's sshd is not running). */
const manualSshd = (ctx: InitContext): number | null =>
  ctx.host.proc.list().find((p) => p.uid === ctx.host.proc.uid && basename(p.exe) === "sshd")?.pid ?? null;

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
    manual: running ? null : manualSshd(ctx),
  };
};

const plan = (ctx: InitContext, s: SshState): PlanLine[] => {
  if (s.upgrade)
    return ctx.args.sshKey === null
      ? []
      : [
          {
            kind: "warning",
            text: tr("SSH is skipped during an upgrade", "SSH dilewati saat upgrade"),
            hint: tr(
              `run panel init --ssh-key ${ctx.args.sshKey} again after the upgrade`,
              `jalankan lagi panel init --ssh-key ${ctx.args.sshKey} setelah upgrade`,
            ),
          },
        ];
  const lines: PlanLine[] = [];
  if (s.add.length > 0) {
    const fps = s.add.map((k) => k.fingerprint).join(", ");
    lines.push({
      kind: "action",
      text: tr(
        `Add ${s.add.length} SSH ${s.add.length === 1 ? "key" : "keys"} to ~/.ssh/authorized_keys: ${fps}`,
        `Tambah ${s.add.length} kunci SSH ke ~/.ssh/authorized_keys: ${fps}`,
      ),
    });
  } else
    lines.push({
      kind: "ok",
      text: tr(`SSH keys already registered (${s.keys.length})`, `Kunci SSH sudah terdaftar (${s.keys.length})`),
    });
  if (s.dropIn === "write" || s.dropIn === "no-config")
    lines.push({
      kind: "action",
      text: tr("Turn off SSH password login (keys only)", "Matikan masuk SSH dengan kata sandi (hanya kunci)"),
    });
  if (s.manual !== null)
    lines.push({
      kind: "warning",
      text: tr(
        `SSH was started by hand (pid ${s.manual}), not through runit; left as is`,
        `SSH sudah dinyalakan manual (pid ${s.manual}), bukan lewat runit; dibiarkan`,
      ),
      hint: tr(
        `to have it start automatically when the phone boots: kill ${s.manual}, then sv up sshd`,
        `agar menyala sendiri setelah HP restart: kill ${s.manual}, lalu sv up sshd`,
      ),
    });
  else if (!s.running)
    lines.push({ kind: "action", text: tr(`Start SSH (port ${SSHD_PORT})`, `Nyalakan SSH (port ${SSHD_PORT})`) });
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

const apply = async (ctx: InitContext, s: SshState, timing: InitTiming): Promise<void> => {
  if (s.upgrade) return;
  const { out, state } = ctx;
  const p = sshPaths(ctx);
  if (s.add.length > 0) {
    for (const k of s.add) out.line(`  ${k.fingerprint} (${k.type})`);
    const n = s.add.length;
    if (
      ctx.tty &&
      !(await ctx.prompt.confirm(tr(`Add these ${n} ${n === 1 ? "key" : "keys"}?`, `Tambahkan ${n} kunci ini?`), true))
    ) {
      out.line(tr("  SSH skipped: the keys were not added.", "  SSH dilewati: kunci tidak ditambahkan."));
      state.manual.push(
        tr(
          `SSH is not set up: run ${ctx.resumeCommand()} --ssh-key <the right key> again`,
          `SSH belum disiapkan: jalankan lagi ${ctx.resumeCommand()} --ssh-key <kunci yang benar>`,
        ),
      );
      return;
    }
    state.changed.push(...writeKeys(p, s.add));
  }
  if (s.dropIn === "write") {
    mkdirSync(p.dropInDir, { recursive: true });
    writeFileSync(p.dropIn, DROP_IN, { mode: 0o644 });
    state.changed.push(p.dropIn);
    if (s.running || s.manual !== null)
      state.manual.push(
        tr(
          "SSH: key-only login applies after sshd restarts (sv restart sshd)",
          "SSH: masuk hanya dengan kunci berlaku setelah sshd dinyalakan ulang (sv restart sshd)",
        ),
      );
  } else if (s.dropIn === "no-include" || s.dropIn === "user-set") {
    out.check(
      "info",
      tr(
        "sshd settings not changed (password sign-in is set in sshd_config)",
        "Pengaturan sshd tidak diubah (masuk dengan kata sandi diatur sshd_config)",
      ),
    );
  }
  if (s.manual !== null)
    state.manual.push(
      tr(
        `SSH runs by hand (pid ${s.manual}); to put it under runit: kill ${s.manual}, then sv up sshd`,
        `SSH berjalan manual (pid ${s.manual}); agar ikut runit: kill ${s.manual}, lalu sv up sshd`,
      ),
    );
  else if (!s.running) {
    if (!existsSync(p.service))
      throw new CliExit(
        INIT_EXIT.failed,
        tr(`The sshd service is missing at ${p.service}.`, `Layanan sshd tidak ada di ${p.service}.`),
        tr("install it: pkg install openssh", "pasang: pkg install openssh"),
      );
    if (s.down) {
      rmSync(p.down, { force: true });
      state.changed.push(p.down);
    }
    await sv(ctx, ["up", "sshd"], timing); // retried: runsv may not supervise a just-installed folder yet
  }
  const host = existsSync(p.hostKey) ? parseKey(readFileSync(p.hostKey, "utf8")) : null;
  out.check(
    host ? "ok" : "warning",
    host
      ? tr(`Phone (host) fingerprint: ${host.fingerprint}`, `Sidik jari HP (host): ${host.fingerprint}`)
      : tr(
          "No phone fingerprint yet (the sshd host key is not created yet)",
          "Sidik jari HP belum ada (kunci host sshd belum dibuat)",
        ),
  );
  // ponytail: IP is not guessed (K22: no `ip` on POCO, Tailscale vs Wi-Fi differ); the user reads it off the phone
  const user = userInfo().username;
  out.line(
    tr(
      `  Connect from a computer: ssh -p ${SSHD_PORT} ${user}@<phone IP: see Tailscale/Wi-Fi>`,
      `  Masuk dari komputer: ssh -p ${SSHD_PORT} ${user}@<IP HP: lihat Tailscale/Wi-Fi>`,
    ),
  );
};

/** Step 3a with `timing` (tests shorten the `sv` retry). */
export const createSshStep = (timing: InitTiming = INIT_TIMING) =>
  defineStep<SshState>({
    id: "ssh",
    detect,
    plan,
    apply: (ctx, s) => apply(ctx, s, timing),
  });

/** Step 3a: SSH access from `--ssh-key` (K22, C26). */
export const sshStep = createSshStep();
