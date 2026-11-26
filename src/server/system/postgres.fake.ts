import { readFileSync, writeFileSync } from "node:fs";
import type { DatabaseInfo } from "../../shared/panel.types";
import { type PostgresAdapter, SystemError } from "./system.types";

const FAKE_DUMP_MAGIC = "PGDMP";
const FAKE_SERVER_VERSION = "18.7";
/** Tables every fake restore reports. */
const FAKE_TABLE_COUNT = 3;

/** In-memory PostgreSQL: dumps are small marker files that verify/restore check. `initial` replaces the demo list. */
export function createFakePostgres(initial?: DatabaseInfo[]): PostgresAdapter {
  const databases: DatabaseInfo[] = initial?.map((d) => ({ ...d })) ?? [
    { name: "adminneo", owner: "postgres", sizeBytes: 8_000_000 },
    { name: "solusi", owner: "solusi", sizeBytes: 24_500_000 },
  ];
  const has = (name: string) => databases.some((d) => d.name === name);
  const add = (name: string, owner: string) => {
    if (has(name)) throw new SystemError(`createdb ${name}: database exists`);
    databases.push({ name, owner, sizeBytes: 7_000_000 });
    databases.sort((a, b) => a.name.localeCompare(b.name));
  };
  const drop = (name: string) => {
    const i = databases.findIndex((d) => d.name === name);
    if (i !== -1) databases.splice(i, 1);
  };
  function verify(file: string) {
    let head: string;
    try {
      head = readFileSync(file, "utf8").slice(0, FAKE_DUMP_MAGIC.length);
    } catch (e) {
      throw new SystemError(`pg_restore verify ${file}: ${(e as Error).message}`, { cause: e });
    }
    if (head !== FAKE_DUMP_MAGIC) throw new SystemError(`pg_restore verify ${file}: not a dump`);
  }
  return {
    listDatabases: async () => databases.map((d) => ({ ...d })),
    createRoleAndDatabase: async (name) => add(name, name),
    dropRoleAndDatabase: async (name) => drop(name),
    async dump(name, file) {
      if (!has(name)) throw new SystemError(`pg_dump ${name}: database does not exist`);
      writeFileSync(file, `${FAKE_DUMP_MAGIC} fake dump of ${name}\n`);
    },
    dumpGlobals: async (file) => writeFileSync(file, "-- fake globals: CREATE ROLE solusi;\n"),
    verifyDump: async (file) => verify(file),
    serverVersion: async () => FAKE_SERVER_VERSION,
    async restoreInto(file, target, owner) {
      verify(file);
      add(target, owner);
      return { tableCount: FAKE_TABLE_COUNT };
    },
    dropDatabase: async (name) => drop(name),
  };
}
