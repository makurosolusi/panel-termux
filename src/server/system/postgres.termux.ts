import type { DatabaseInfo } from "../../shared/panel.types";
import { runTermux } from "../exec/termux.exec";
import { type PostgresAdapter, SQL_IDENT_RE, SystemError } from "./system.types";

/**
 * Role postgres has `trust` only on the local unix socket (TCP 127.0.0.1 is scram-sha-256, verified on the
 * phone), so PGHOST is left to psql's default socket unless set in env. PGUSER env overrides the role.
 */
const DEFAULT_PGUSER = "postgres";

/** A site database dump on the phone takes seconds; the cap only stops a hung pg_dump. */
const DUMP_TIMEOUT_MS = 30 * 60_000;

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

/** Random site passwords are hex; anything else could break the psql `\set` quoting below. */
const PASSWORD_RE = /^[0-9a-f]{16,128}$/;

function assertIdent(name: string): void {
  if (!SQL_IDENT_RE.test(name)) throw new SystemError(`postgres: invalid identifier ${JSON.stringify(name)}`);
}

/**
 * psql script for create/drop. Values go through psql variables (`:"name"` quotes an identifier,
 * `:'pw'` a literal) and the whole script is fed on stdin, so the password never appears on argv.
 */
export const createSql = (name: string, password: string) =>
  `\\set ON_ERROR_STOP on\n\\set name '${name}'\n\\set pw '${password}'\n` +
  `CREATE ROLE :"name" LOGIN PASSWORD :'pw';\nCREATE DATABASE :"name" OWNER :"name";\n`;
export const dropSql = (name: string) =>
  `\\set ON_ERROR_STOP on\n\\set name '${name}'\n` +
  `DROP DATABASE IF EXISTS :"name" WITH (FORCE);\nDROP ROLE IF EXISTS :"name";\n`;

/** Real PostgreSQL adapter via `psql`. */
export function createTermuxPostgres(): PostgresAdapter {
  const env = () => ({ ...process.env, PGUSER: process.env.PGUSER || DEFAULT_PGUSER });
  async function script(op: string, input: string, redact?: string): Promise<void> {
    // -w: never prompt for a password (fail instead of hanging).
    const r = await runTermux("psql", ["-X", "-w", "-q", "-d", "postgres", "-f", "-"], { env: env(), input });
    if (r.code === 0) return;
    // An error context line ("LINE 1: CREATE ROLE ...") could quote the password literal; mask it first.
    const err = redact ? r.stderr.replaceAll(redact, "***") : r.stderr;
    throw new SystemError(`psql ${op} exited ${r.code}: ${err.trim().slice(0, 200)}`);
  }
  return {
    async listDatabases() {
      const r = await runTermux("psql", ["-X", "-w", "-At", "-F", "\t", "-d", "postgres", "-c", LIST_SQL], {
        env: env(),
      });
      if (r.code !== 0) throw new SystemError(`psql list databases exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
      return parsePsqlDatabases(r.stdout);
    },
    async createRoleAndDatabase(name, password) {
      assertIdent(name);
      if (!PASSWORD_RE.test(password)) throw new SystemError("postgres: password must be hex");
      await script(`create ${name}`, createSql(name, password), password);
    },
    async dropRoleAndDatabase(name) {
      assertIdent(name);
      await script(`drop ${name}`, dropSql(name));
    },
    async dump(name, file) {
      assertIdent(name);
      const r = await runTermux("pg_dump", ["-Fc", "-w", "-f", file, "-d", name], {
        env: env(),
        timeoutMs: DUMP_TIMEOUT_MS,
      });
      if (r.code !== 0) throw new SystemError(`pg_dump ${name} exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
    },
  };
}
