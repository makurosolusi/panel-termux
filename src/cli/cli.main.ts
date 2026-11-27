// CLI dispatcher (PLAN/07 K2, K3, §2.1, §2.2). Static imports stay in src/cli + src/shared + package.json so
// `-v`/`--help` evaluate nothing of the server; commands and CliHost load on demand (lab L5).
import { type ParseArgsConfig, parseArgs } from "node:util";
import pkg from "../../package.json" with { type: "json" };
import { COMMAND_HELP, COMMAND_NAMES, type CommandName, GENERAL_HELP, SERVE_HINT, UPGRADE_HINT } from "./cli.help";
import type { CliHost } from "./cli.host";
import { CliExit, type CliOut, createCliOut } from "./cli.output";

/** Parsed flags and positionals of one command (node:util parseArgs, strict). */
export type ParsedArgs = {
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  positionals: string[];
};
/** What a command gets: output and the lazily detected host (K13; `env`/`docs` never ask for it). */
export type CliIo = { out: CliOut; host: () => Promise<CliHost> };
/** A CLI command; resolves to the exit code (§2.2). Throw CliExit to end with a message. */
export type Command = (args: ParsedArgs, io: CliIo) => Promise<number>;

type Spec = { options: NonNullable<ParseArgsConfig["options"]>; maxPositionals: number; load: () => Promise<Command> };

const HELP = { help: { type: "boolean", short: "h" } } as const;
const GLOBAL = { options: { ...HELP, version: { type: "boolean", short: "v" } }, maxPositionals: 0 } as const;
const USAGE = 2;
const FAILED = 1;
/** Names that are not commands but get the UPGRADE_HINT (upgrade waits for signed releases, C14). */
const LATER = new Set(["upgrade"]);

const COMMANDS: Record<CommandName, Spec> = {
  // Reached only via runCli(["serve"]) directly: main.ts routes `serve` to boot before the CLI scrubs the env.
  serve: {
    options: {},
    maxPositionals: 0,
    load: async () => async () => {
      await (await import("../server/boot")).start();
      return 0;
    },
  },
  doctor: {
    options: { json: { type: "boolean" } },
    maxPositionals: 0,
    load: async () => (await import("./doctor.command")).doctorCommand,
  },
  docs: { options: {}, maxPositionals: 1, load: async () => (await import("./docs.command")).docsCommand },
  env: {
    options: { full: { type: "boolean" } },
    maxPositionals: 0,
    load: async () => (await import("./env.command")).envCommand,
  },
  rollback: {
    options: { db: { type: "boolean" }, yes: { type: "boolean", short: "y" } },
    maxPositionals: 0,
    load: async () => (await import("./rollback.command")).rollbackCommand,
  },
  // PLAN/07 §2.1 (0.5.1): no --downgrade/--port/--tunnel (C27)
  init: {
    options: {
      yes: { type: "boolean", short: "y" },
      "dry-run": { type: "boolean" },
      hostname: { type: "string" },
      "admin-email": { type: "string", multiple: true },
      skip: { type: "string", multiple: true },
      "ssh-key": { type: "string" },
      "skip-verify": { type: "boolean" },
    },
    maxPositionals: 0,
    load: async () => (await import("./init.command")).initCommand,
  },
};

/** `panel-termux <version> (<platform>-<arch>, bun <version>)`; version embedded from package.json at build. */
export const versionLine = (): string =>
  `panel-termux ${pkg.version} (${process.platform}-${process.arch}, bun ${Bun.version})`;

/** Aliases before parsing (K3): `--v`/`--h` → long flags, leading `--env` → `env`, `help [cmd]` → `[cmd] --help`. */
export function normalizeArgv(argv: readonly string[]): string[] {
  const out = argv.map((a) => (a === "--v" ? "--version" : a === "--h" ? "--help" : a));
  if (out[0] === "--env") out[0] = "env";
  if (out[0] === "help") return [...out.slice(1), "--help"];
  return out;
}

const PARSE_ERRORS: Record<string, string> = {
  ERR_PARSE_ARGS_UNKNOWN_OPTION: "Opsi tidak dikenal",
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE: "Nilai opsi tidak valid",
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL: "Argumen tidak dikenal",
};

/** parseArgs, with its errors turned into an exit-2 CliExit naming the offending argument. */
function parse(args: string[], spec: Pick<Spec, "options" | "maxPositionals">, helpRef: string): ParsedArgs {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs({ args, options: spec.options, strict: true, allowPositionals: spec.maxPositionals > 0 });
  } catch (e) {
    const what = PARSE_ERRORS[(e as { code?: string }).code ?? ""];
    if (!what) throw e;
    const arg = /'([^']+)'/.exec((e as Error).message)?.[1] ?? args.join(" ");
    throw new CliExit(USAGE, `${what}: ${arg}`, `lihat: ${helpRef} --help`);
  }
  const extra = parsed.positionals[spec.maxPositionals];
  if (extra !== undefined) throw new CliExit(USAGE, `Argumen tidak dikenal: ${extra}`, `lihat: ${helpRef} --help`);
  return parsed;
}

async function detectHost(): Promise<CliHost> {
  const { detectCliHost, FakeScenarioError, NotTermuxError } = await import("./cli.host");
  try {
    return await detectCliHost();
  } catch (e) {
    if (e instanceof NotTermuxError)
      throw new CliExit(FAILED, e.message, "untuk mencoba tanpa Termux: PANEL_CLI_FAKE=ready panel doctor");
    if (e instanceof FakeScenarioError) throw new CliExit(USAGE, e.message);
    throw e;
  }
}

async function dispatch(argv: string[], out: CliOut, host: () => Promise<CliHost>): Promise<number> {
  if (argv.length === 0) {
    out.note(GENERAL_HELP);
    out.note(SERVE_HINT);
    return USAGE;
  }
  const [first = "", ...rest] = argv;
  if (first.startsWith("-")) {
    out.line(parse(argv, GLOBAL, "panel").values.help ? GENERAL_HELP : versionLine());
    return 0;
  }
  if (!(COMMAND_NAMES as readonly string[]).includes(first)) {
    out.fail(`Perintah tidak dikenal: ${first}`, "lihat: panel --help");
    if (LATER.has(first)) out.note(UPGRADE_HINT);
    return USAGE;
  }
  const name = first as CommandName;
  const spec = COMMANDS[name];
  const args = parse(rest, { ...spec, options: { ...spec.options, ...HELP } }, `panel ${name}`);
  if (args.values.help) {
    out.line(COMMAND_HELP[name]);
    return 0;
  }
  const command = await spec.load();
  try {
    return await command(args, { out, host });
  } catch (e) {
    if (e instanceof CliExit) throw e;
    throw new CliExit(FAILED, `Gagal menjalankan panel ${name}: ${(e as Error).message}`);
  }
}

/** Runs the CLI for `argv` (without the binary name) and returns the exit code; never serves (main.ts does). */
export async function runCli(argv: readonly string[], io: Partial<CliIo> = {}): Promise<number> {
  const out = io.out ?? createCliOut();
  let cached: Promise<CliHost> | undefined;
  const host = io.host ?? (() => (cached ??= detectHost()));
  try {
    return await dispatch(normalizeArgv(argv), out, host);
  } catch (e) {
    if (!(e instanceof CliExit)) throw e;
    out.fail(e.message, e.hint);
    return e.code;
  }
}
