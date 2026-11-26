import { expect, test } from "bun:test";
import { app, BOOT_ID } from "@/server/boot";
import pkg from "../package.json" with { type: "json" };

test("GET /api/health returns ok + version + this process's bootId", async () => {
  const res = await app.handle(new Request("http://localhost/api/health"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, version: pkg.version, bootId: BOOT_ID });
  expect(BOOT_ID).toMatch(/^[0-9a-f-]{36}$/);
});
