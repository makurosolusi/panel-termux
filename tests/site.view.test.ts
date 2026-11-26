// toSites: last deploy + hostnames for N sites come from a fixed number of queries (no N+1), output unchanged.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { deploy, job, site, siteHostname, user } from "@/server/db/schema";
import { toSites } from "@/server/sites/site.view";

const dir = mkdtempSync(join(tmpdir(), "panel-site-view-"));
const db = openDb(dir);
runMigrations(db);
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

// test-only fixture: 30 sites; site i has i deploys (site 0 none), newest by an actor only on even sites.
const N = 30;
db.insert(user).values({ id: "u1", name: "Ana", email: "ana@example.com" }).run();
db.insert(job)
  .values({ id: "j1", kind: "site.deploy", target: "x", status: "succeeded", steps: [], startedAt: new Date(0) })
  .run();
for (let i = 0; i < N; i++) {
  const name = `s${String(i).padStart(2, "0")}`;
  db.insert(site)
    .values({ name, port: 4000 + i, runtime: "native", managed: true, dir: `/sites/${name}` })
    .run();
  db.insert(siteHostname)
    .values({ hostname: `${name}.example.com`, siteName: name, ingressManaged: true, dnsManaged: false })
    .run();
  for (let k = 1; k <= i; k++) {
    const newest = k === i;
    db.insert(deploy)
      .values({
        id: `${name}-${k}`,
        siteName: name,
        kind: "deploy",
        status: newest ? "failed" : "succeeded",
        sha256: "x",
        sizeBytes: 1,
        runtime: "native",
        jobId: "j1",
        actorId: newest && i % 2 === 0 ? "u1" : null,
        at: new Date(1_000_000 + i * 1000 + k),
      })
      .run();
  }
}

test("toSites batches deploy + hostname lookups and keeps the per-site output", () => {
  const rows = db.select().from(site).orderBy(site.name).all();
  const prepare = db.$client.prepare.bind(db.$client);
  let queries = 0;
  db.$client.prepare = ((q: string) => {
    queries++;
    return prepare(q);
  }) as typeof db.$client.prepare;
  let out: ReturnType<typeof toSites>;
  try {
    out = toSites(db, rows, null);
  } finally {
    db.$client.prepare = prepare;
  }
  expect(queries).toBe(2); // hostnames + latest deploys, independent of N
  expect(out).toHaveLength(N);
  expect(out[0]?.lastDeploy).toBeNull();
  expect(out[0]?.appStatus).toBe("unknown");
  expect(out[7]?.hostnames).toEqual(["s07.example.com"]);
  expect(out[7]?.lastDeploy).toEqual({
    at: new Date(1_000_000 + 7 * 1000 + 7).toISOString(),
    kind: "deploy",
    status: "failed",
    actorName: null,
  });
  expect(out[12]?.lastDeploy?.actorName).toBe("Ana");
  expect(out[12]?.lastDeploy?.at).toBe(new Date(1_000_000 + 12 * 1000 + 12).toISOString());
});

test("toSites with no rows runs no query", () => {
  expect(toSites(db, [], null)).toEqual([]);
});
