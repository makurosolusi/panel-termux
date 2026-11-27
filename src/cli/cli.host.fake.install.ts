// What the fake host's tools leave behind (PLAN/07 §16 G1a), so `PANEL_CLI_FAKE=fresh panel init` runs every step
// to the end and a rerun sees the result: dpkg state lives in the sandbox's `$PREFIX/var/lib/dpkg/status`, `pkg
// install` drops the package's files (binaries, runit folders with `down` like Termux packages), initdb writes
// PG_VERSION, service-daemon its pidfile, `sv up` a supervise/stat, cloudflared login/create its cert and credentials.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExecResult } from "../server/exec/termux.exec";
import { type CliPaths, probePaths } from "./cli.host";

/** Pid of the fake runsvdir (service-daemon pidfile). */
export const FAKE_DAEMON_PID = 900;
/** PostgreSQL major in PG_VERSION and `postgres --version` (they match: `postgres_major` ok). */
export const FAKE_PG_MAJOR = "17";
/** Version the fake apt offers for every package (`apt-get -s install`). */
const FAKE_PKG_VERSION = "1.0.0-1";
const SH = "#!/data/data/com.termux/files/usr/bin/sh\n";
/**
 * openssh's sshd_config as shipped (lab: POCO's is the unmodified package default): it includes sshd_config.d and sets
 * no PasswordAuthentication, so init's key-only drop-in applies.
 */
const SSHD_CONFIG = `Include /data/data/com.termux/files/usr/etc/ssh/sshd_config.d/*.conf
PrintMotd yes
Subsystem sftp /data/data/com.termux/files/usr/libexec/sftp-server
`;
/** cloudflared's packaged run script (lab L2): token file, no --no-autoupdate. */
const CF_TEMPLATE = `${SH}exec cloudflared tunnel run --token-file $HOME/.cloudflared/token 2>&1\n`;

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): ExecResult => ({ code: 1, stdout: "", stderr });
const statusFile = (p: CliPaths) => join(p.prefix, "var", "lib", "dpkg", "status");

function put(file: string, content: string, mode = 0o755): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { mode });
}

/** Installed packages → `install` or `hold` (the selection state dpkg prints first in `Status:`). */
export type DpkgDb = Map<string, "install" | "hold">;

/** Reads the sandbox dpkg status (absent = nothing installed). */
export function readDpkg(p: CliPaths): DpkgDb {
  const db: DpkgDb = new Map();
  const file = statusFile(p);
  if (!existsSync(file)) return db;
  for (const block of readFileSync(file, "utf8").split("\n\n")) {
    const name = /^Package: (\S+)$/m.exec(block)?.[1];
    const want = /^Status: (install|hold) ok installed$/m.exec(block)?.[1] as "install" | "hold" | undefined;
    if (name && want) db.set(name, want);
  }
  return db;
}

function writeDpkg(p: CliPaths, db: DpkgDb): void {
  const blocks = [...db].map(([name, want]) => `Package: ${name}\nStatus: ${want} ok installed\n`);
  put(statusFile(p), blocks.join("\n"), 0o644);
}

/** Writes the scenario's packages once; a sandbox that already has a status file keeps it (rerun). */
export function seedDpkg(p: CliPaths, packages: readonly string[], held: readonly string[]): void {
  if (existsSync(statusFile(p))) return;
  writeDpkg(p, new Map(packages.map((n) => [n, held.includes(n) ? "hold" : "install"])));
}

/** A well-formed ed25519 public key line (blob = type + 32 bytes), so sshd's host fingerprint parses. */
function hostKeyLine(): string {
  const type = Buffer.from("ssh-ed25519");
  const len = (n: number) => Buffer.from([0, 0, 0, n]);
  const blob = Buffer.concat([len(type.length), type, len(32), Buffer.alloc(32, 7)]);
  return `ssh-ed25519 ${blob.toString("base64")} fake-host\n`;
}

/** A runit folder as a Termux package ships it: run + `down` (service off until enabled). */
function packagedService(p: CliPaths, name: string, run: string): void {
  if (existsSync(join(p.svdir, name))) return;
  put(join(p.svdir, name, "run"), run, 0o700);
  put(join(p.svdir, name, "down"), "", 0o600);
}

/** Files `pkg install <name>` leaves (only what init and doctor look at). */
function installFiles(p: CliPaths, name: string): void {
  const bin = (tool: string) => put(join(p.prefix, "bin", tool), SH);
  if (name === "termux-services") {
    for (const t of ["sv", "service-daemon"]) bin(t);
    put(join(p.prefix, "share", "termux-services", "svlogger"), SH);
  } else if (name === "nodejs-lts") for (const t of ["node", "npm"]) bin(t);
  else if (name === "postgresql") {
    for (const t of ["postgres", "initdb"]) bin(t);
    packagedService(p, "postgres", `${SH}exec postgres 2>&1\n`);
  } else if (name === "cloudflared") {
    bin("cloudflared");
    packagedService(p, "cloudflared", CF_TEMPLATE);
  } else if (name === "openssh") {
    bin("sshd");
    packagedService(p, "sshd", `${SH}exec sshd -D -e 2>&1\n`);
    const etc = join(p.prefix, "etc", "ssh");
    put(join(etc, "sshd_config"), SSHD_CONFIG, 0o644);
    put(join(etc, "ssh_host_ed25519_key.pub"), hostKeyLine(), 0o644);
  }
}

function hold(p: CliPaths, names: readonly string[]): void {
  const db = readDpkg(p);
  for (const n of names) if (db.has(n)) db.set(n, "hold");
  writeDpkg(p, db);
}

/** Side effect of a `run` (long, visible) command; returns its exit code. Unknown commands succeed and do nothing. */
export function runEffect(p: CliPaths, tool: string, args: readonly string[]): number {
  const name = basename(tool);
  const probe = probePaths(p);
  if (name === "pkg" && args[0] === "install") {
    const pkgs = args.slice(1).filter((a) => !a.startsWith("-") && !a.startsWith("Dpkg::"));
    const db = readDpkg(p);
    for (const n of pkgs) {
      installFiles(p, n);
      if (!db.has(n)) db.set(n, "install");
    }
    writeDpkg(p, db);
  } else if (name === "npm" && args[0] === "install" && args.some((a) => a.startsWith("pm2@")))
    put(probe.pm2Runtime, "#!/usr/bin/env node\n");
  else if (name === "initdb") {
    const dir = args[args.indexOf("-D") + 1] ?? dirname(probe.pgVersion);
    put(join(dir, "PG_VERSION"), `${FAKE_PG_MAJOR}\n`, 0o600);
  } else if (name === "service-daemon" && args[0] === "start") put(probe.daemonPid, `${FAKE_DAEMON_PID}\n`, 0o644);
  else if (name === "apt-mark" && args[0] === "hold") hold(p, args.slice(1));
  else if (name === "cloudflared" && args.join(" ") === "tunnel login")
    put(join(probe.cloudflaredDir, "cert.pem"), "fake cert\n", 0o600); // test-only
  return 0;
}

type Tunnel = { id: string; name: string };
function tunnels(p: CliPaths): Tunnel[] {
  const dir = probePaths(p).cloudflaredDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { TunnelID: string; TunnelName?: string })
    .filter((c) => c.TunnelName)
    .map((c) => ({ id: c.TunnelID, name: c.TunnelName as string }));
}

/**
 * Side effect / answer of an `exec` that changes state or depends on it (sv, apt-get -s, apt-mark hold, cloudflared
 * tunnel list/create); undefined = not handled here. `svUp` marks a service started (the host keeps that state).
 */
export function execEffect(
  p: CliPaths,
  tool: string,
  args: readonly string[],
  svUp: (name: string) => void,
): ExecResult | undefined {
  const name = basename(tool);
  if (name === "apt-get" && args[0] === "-s" && args[1] === "install") {
    const db = readDpkg(p);
    const pkgs = args.slice(2).filter((n) => !db.has(n));
    return ok(pkgs.map((n) => `Inst ${n} (${FAKE_PKG_VERSION} stable [aarch64])\n`).join(""));
  }
  if (name === "apt-mark" && args[0] === "hold") {
    hold(p, args.slice(1));
    return ok();
  }
  if (name === "sv" && args[0] !== "status") {
    const svc = args.at(-1) ?? "";
    if (!existsSync(join(p.svdir, svc))) return fail(`fail: ${svc}: unable to change to service directory\n`);
    svUp(svc);
    return ok(`ok: run: ${svc}\n`);
  }
  if (name === "cloudflared" && args[0] === "tunnel" && args[1] === "list") {
    const want = args[args.indexOf("-n") + 1];
    return ok(JSON.stringify(tunnels(p).filter((t) => t.name === want)));
  }
  if (name === "cloudflared" && args[0] === "tunnel" && args[1] === "create") {
    const id = crypto.randomUUID();
    const cred = { AccountTag: "fake", TunnelSecret: "fake-tunnel-secret", TunnelID: id, TunnelName: args[2] }; // test-only
    put(join(probePaths(p).cloudflaredDir, `${id}.json`), JSON.stringify(cred), 0o400);
    return ok(`Created tunnel ${args[2]} with id ${id}\n`);
  }
  return undefined;
}
