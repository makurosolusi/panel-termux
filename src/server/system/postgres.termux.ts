import type { DatabaseInfo } from "../../shared/panel.types";
import { runTermux } from "../exec/termux.exec";
import { type PostgresAdapter, SystemError } from "./system.types";

/**
 * Role postgres has `trust` only on the local unix socket (TCP 127.0.0.1 is scram-sha-256, verified on the
 * phone), so PGHOST is left to psql's default socket unless set in env. PGUSER env overrides the role.
 */
const DEFAULT_PGUSER = "postgres";

const LIST_SQL =
  "SELECT datname, pg_get_userbyid(datdba), pg_database_size(datname) FROM pg_database " +
  "WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname";

/** Parses `psql -At -F '\t'` rows of `name\towner\tsize`. */
export function parsePsqlDatabases(stdout: string): DatabaseInfo[] {
  return stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const cols = l.split("\t");
      const [name = "", owner = "", size = ""] = cols;
      const sizeBytes = Number(size);
      if (cols.length !== 3 || !name || size === "" || !Number.isFinite(sizeBytes))
        throw new SystemError("psql: unexpected database row format");
      return { name, owner, sizeBytes };
    });
}

/** Real PostgreSQL adapter via `psql`. */
export function createTermuxPostgres(): PostgresAdapter {
  return {
    async listDatabases() {
      const env = { ...process.env, PGUSER: process.env.PGUSER || DEFAULT_PGUSER };
      // -w: never prompt for a password (fail instead of hanging).
      const r = await runTermux("psql", ["-X", "-w", "-At", "-F", "\t", "-d", "postgres", "-c", LIST_SQL], { env });
      if (r.code !== 0) throw new SystemError(`psql list databases exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
      return parsePsqlDatabases(r.stdout);
    },
  };
}
