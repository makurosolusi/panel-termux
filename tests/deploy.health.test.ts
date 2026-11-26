import { describe, expect, test } from "bun:test";
import { baselineOf, type HealthTarget, passes, waitHealthy } from "@/server/deploy/health.check";
import { StepError } from "@/server/sites/job.step";
import type { NetAdapter, Pm2Adapter, Pm2Proc } from "@/server/system/system.types";
import { FAST_TIMING } from "./deploy.fixture";

/** One pm2 app whose fields the test changes between jlists; `jlists` counts reads. */
function fakePm2(init: Partial<Pm2Proc>) {
  const proc = { name: "shop", status: "online", pid: 4242, restarts: 0, ...init } as Pm2Proc;
  let jlists = 0;
  const onRead: ((n: number) => void)[] = [];
  const pm2 = {
    procs: async () => {
      jlists++;
      for (const f of onRead) f(jlists);
      return [proc];
    },
  } as unknown as Pm2Adapter;
  return { pm2, proc, onRead, jlists: () => jlists };
}
/** Port answering `codes` in turn (last one repeats); `hosts` records the Host header sent. */
function fakeNet(codes: (number | null)[], listening = true) {
  const hosts: (string | undefined)[] = [];
  let i = 0;
  const net: NetAdapter = {
    isListening: async () => listening,
    httpStatus: async (_port, _path, _t, host) => {
      hosts.push(host);
      return codes[Math.min(i++, codes.length - 1)] ?? null;
    },
  };
  return { net, hosts };
}
const target = (o: Partial<HealthTarget> = {}): HealthTarget => ({
  app: "shop",
  port: 3100,
  path: "/api/health",
  expect: "lt500",
  timeoutMs: 200,
  host: "shop.example.test",
  ...o,
});
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof StepError) return { code: e.code, params: e.params };
    throw e;
  }
  throw new Error("expected a StepError");
};

describe("expect rules", () => {
  test.each([
    [200, "lt500", true],
    [404, "lt500", true],
    [502, "lt500", false],
    [null, "lt500", false],
    [302, "2xx3xx", true],
    [404, "2xx3xx", false],
    [199, "2xx3xx", false],
  ] as const)("%p with %s → %p", (code, expect_, ok) => expect(passes(code, expect_)).toBe(ok));
});

describe("waitHealthy", () => {
  test("healthy: two passing probes + same pid twice, Host header sent", async () => {
    const { pm2 } = fakePm2({});
    const { net, hosts } = fakeNet([200]);
    const out = await waitHealthy({ pm2, net }, target(), { pid: 4242, restarts: 0 }, FAST_TIMING);
    expect(out).toMatchObject({ code: "healthy", params: { status: 200, path: "/api/health" } });
    expect(hosts.every((h) => h === "shop.example.test")).toBe(true);
  });

  test("baseline without pid takes the first valid one", async () => {
    const { pm2 } = fakePm2({ pid: 77 });
    const out = await waitHealthy({ pm2, net: fakeNet([200]).net }, target(), { pid: null, restarts: 0 }, FAST_TIMING);
    expect(out.code).toBe("healthy");
  });

  test("E3: pm2 online without pid while something answers → app_no_pid, never healthy", async () => {
    const { pm2 } = fakePm2({ pid: null });
    const r = await fails(waitHealthy({ pm2, net: fakeNet([200]).net }, target(), null, FAST_TIMING));
    expect(r).toEqual({ code: "app_no_pid", params: { name: "shop" } });
  });

  test("port refused until the deadline → health_timeout last=refused", async () => {
    const { pm2 } = fakePm2({});
    const r = await fails(waitHealthy({ pm2, net: fakeNet([200], false).net }, target(), null, FAST_TIMING));
    expect(r).toMatchObject({ code: "health_timeout", params: { last: "refused", path: "/api/health" } });
  });

  test("answers 502 → health_timeout with the last status", async () => {
    const { pm2 } = fakePm2({});
    const r = await fails(waitHealthy({ pm2, net: fakeNet([502]).net }, target(), null, FAST_TIMING));
    expect(r).toMatchObject({ code: "health_timeout", params: { last: 502 } });
  });

  test("no answer → last=no_answer; 404 fails 2xx3xx", async () => {
    const { pm2 } = fakePm2({});
    expect(await fails(waitHealthy({ pm2, net: fakeNet([null]).net }, target(), null, FAST_TIMING))).toMatchObject({
      params: { last: "no_answer" },
    });
    const r = await fails(
      waitHealthy({ pm2, net: fakeNet([404]).net }, target({ expect: "2xx3xx" }), null, FAST_TIMING),
    );
    expect(r).toMatchObject({ code: "health_timeout", params: { last: 404 } });
  });

  test("pm2 restarted the app during the settle window → app_unstable", async () => {
    const f = fakePm2({});
    f.onRead.push((n) => {
      if (n >= 2) f.proc.restarts = 1;
    });
    const r = await fails(
      waitHealthy({ pm2: f.pm2, net: fakeNet([200]).net }, target(), { pid: 4242, restarts: 0 }, FAST_TIMING),
    );
    expect(r).toEqual({ code: "app_unstable", params: { restarts: 1 } });
  });

  test("pid changed since the baseline → app_unstable", async () => {
    const { pm2 } = fakePm2({ pid: 5000 });
    const r = await fails(
      waitHealthy({ pm2, net: fakeNet([200]).net }, target(), { pid: 4242, restarts: 0 }, FAST_TIMING),
    );
    expect(r.code).toBe("app_unstable");
  });

  test("errored at a periodic pm2 read → app_errored even before the port answers", async () => {
    const { pm2 } = fakePm2({ status: "errored" });
    const r = await fails(
      waitHealthy({ pm2, net: fakeNet([null], false).net }, target({ timeoutMs: 1000 }), null, FAST_TIMING),
    );
    expect(r).toEqual({ code: "app_errored", params: { name: "shop" } });
  });

  test("a failed answer after the settle window resets the streak (flapping app)", async () => {
    const { pm2 } = fakePm2({});
    const { net } = fakeNet([200, 200, 500, 500, 200, 200, 200]);
    const out = await waitHealthy({ pm2, net }, target({ timeoutMs: 1000 }), { pid: 4242, restarts: 0 }, FAST_TIMING);
    expect(out.code).toBe("healthy");
  });

  test("baselineOf reads pid/restarts; unknown app → null", async () => {
    const { pm2 } = fakePm2({ pid: 9, restarts: 3 });
    expect(await baselineOf(pm2, "shop")).toEqual({ pid: 9, restarts: 3 });
    expect(await baselineOf(pm2, "nope")).toBeNull();
  });
});
