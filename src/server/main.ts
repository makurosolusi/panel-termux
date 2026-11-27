// Build entry (PLAN/07 K1, K2, K11b). Only static import: the pure env schema, so CLI commands never evaluate the
// server bundle (lab L5). `src/server/index.ts` stays the dev/test entry.
import { ENV_VARS } from "../shared/env.schema";

/** Serve only for argv `[]` without a TTY (runit) or exactly `["serve"]`; anything else is the CLI (K2). */
export function entryRoute(argv: readonly string[], isTty: boolean): "serve" | "cli" {
  if (argv.length === 0) return isTty ? "cli" : "serve";
  return argv.length === 1 && argv[0] === "serve" ? "serve" : "cli";
}

/** Deletes every panel config variable from `env`, so `.env` secrets never reach CLI child processes (K11b, D3). */
export function scrubPanelEnv(env: Record<string, string | undefined> = process.env): void {
  for (const v of ENV_VARS) delete env[v.name];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (entryRoute(argv, process.stdin.isTTY === true) === "serve") {
    await (await import("./boot")).start();
  } else {
    scrubPanelEnv();
    const { runCli } = await import("../cli/cli.main");
    process.exitCode = await runCli(argv);
  }
}
