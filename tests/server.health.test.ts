import { expect, test } from "bun:test";
import { app } from "@/server/index";
import pkg from "../package.json" with { type: "json" };

test("GET /api/health returns ok + version", async () => {
  const res = await app.handle(new Request("http://localhost/api/health"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, version: pkg.version });
});
