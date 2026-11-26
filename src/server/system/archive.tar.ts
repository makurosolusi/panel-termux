import { runTermux } from "../exec/termux.exec";
import { type ArchiveAdapter, SystemError } from "./system.types";

/** Archiving a sites folder on the phone takes seconds to minutes; the cap only stops a hung tar. */
const TAR_TIMEOUT_MS = 30 * 60_000;
/** GNU tar: 1 = "some files differ" (changed while being read), the archive is still complete. */
const TAR_EXIT_CHANGED = 1;

/**
 * tar adapter over the binary `tar` (Termux: `$PREFIX/bin/tar`; fake/tests: an absolute host tar path).
 * Entries are passed after `--`, so a file named like an option is archived, not interpreted.
 */
export function createTarArchive(tar = "tar"): ArchiveAdapter {
  async function run(op: string, args: string[]) {
    const r = await runTermux(tar, args, { timeoutMs: TAR_TIMEOUT_MS });
    if (r.code !== 0 && r.code !== TAR_EXIT_CHANGED)
      throw new SystemError(`tar ${op} exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
    return r.code;
  }
  return {
    async create(file, dir, entries) {
      if (entries.length === 0) throw new SystemError(`tar create ${file}: no entries`);
      const code = await run("create", ["-czf", file, "-C", dir, "--", ...entries]);
      return { warning: code === TAR_EXIT_CHANGED ? "file_changed" : null };
    },
    async list(file) {
      const code = await run("list", ["-tzf", file]);
      if (code !== 0) throw new SystemError(`tar list ${file} exited ${code}`);
    },
  };
}
