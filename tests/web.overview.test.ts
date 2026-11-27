// Ringkasan follow-ups of QA fix-04: started rows hide until a new sample, the Layanan tile counts quiet stops.
import { describe, expect, test } from "bun:test";
import type { Problem } from "@/shared/monitor.types";
import { countBadge, quietDownServices, withoutStarted } from "@/web/panel/overview.state";

// test-only fixtures
const p = (id: string, target = "pm2") =>
  ({ id, code: "service_down", kind: "service", severity: "danger", target, params: {} }) as unknown as Problem;

describe("Overview after Start", () => {
  test("a started row stays hidden while the sample is the one seen at the click, back on a newer one", () => {
    const rows = [p("a"), p("b", "postgres")];
    expect(withoutStarted(rows, {}, "t1").map((r) => r.id)).toEqual(["a", "b"]);
    expect(withoutStarted(rows, { a: "t1" }, "t1").map((r) => r.id)).toEqual(["b"]);
    expect(withoutStarted(rows, { a: "t1" }, "t2").map((r) => r.id)).toEqual(["a", "b"]);
    expect(withoutStarted(rows, { a: null }, null).map((r) => r.id)).toEqual(["b"]); // no sample yet
  });

  test("Services tile counts every stopped service, quiet ones without the danger tone", () => {
    const services = [
      { name: "pm2", state: "down" },
      { name: "postgres", state: "down" },
      { name: "crond", state: "down" },
      { name: "sshd", state: "run" },
    ];
    const problems = [p("a")];
    expect(quietDownServices(services, problems)).toBe(2);
    expect(countBadge(["service"], problems, 0, 2)).toEqual({ tone: "danger", text: "3 down" });
    expect(countBadge(["service"], [], 0, 2)).toEqual({ tone: "warning", text: "2 down" });
    expect(countBadge(["service"], [], 0, 0)).toEqual({ tone: "success", text: "All running" });
  });
});
