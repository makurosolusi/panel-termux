// "Start pm2/postgres" button (PLAN/06 §6.1): endpoint, toasts, onStarted.
import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tPanel } from "@/web/i18n/en.panel";
import { tServiceStart } from "@/web/i18n/en.service-start";
import { ServiceStartButton, startService } from "@/web/shared/service-start";
import { toast } from "@/web/shared/toast.lazy";

const realFetch = globalThis.fetch;
const success = spyOn(toast, "success").mockImplementation(() => 1);
const error = spyOn(toast, "error").mockImplementation(() => 1);
afterAll(() => {
  success.mockRestore();
  error.mockRestore();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  success.mockClear();
  error.mockClear();
});

/** Fetch stub answering `status` + `body`; records method and URL. */
const stub = (status: number, body: unknown) => {
  const calls: string[] = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method} ${String(url)}`);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return calls;
};
/** Text of a toast.error message (a CodeText element whose child is the string). */
const errorText = () => (error.mock.calls[0]?.[0] as { props?: { children: string } } | undefined)?.props?.children;
const svc = (state: string) => ({ name: "pm2", state, pid: 9, uptimeSec: 0, downSec: null, wantUp: true });

describe("startService", () => {
  test("POSTs the start endpoint; running → success toast naming the reboot, then onStarted", async () => {
    const calls = stub(200, svc("run"));
    const onStarted = mock(() => {});
    expect(await startService("pm2", onStarted)).toBe(true);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["POST /api/panel/services/pm2/start"]);
    expect(success).toHaveBeenCalledWith(tServiceStart.started("pm2"));
    expect(tServiceStart.started("pm2")).toBe("pm2 is running again and starts automatically when the phone restarts.");
  });

  test("started but still down → error toast, not success", async () => {
    stub(200, svc("down"));
    const onStarted = mock(() => {});
    expect(await startService("postgres", onStarted)).toBe(false);
    expect(onStarted).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(errorText()).toBe(tServiceStart.notRunning("postgres"));
  });

  test("server error code → its panel message", async () => {
    stub(409, { error: "job_running", message: "busy" });
    expect(await startService("pm2")).toBe(false);
    expect(errorText()).toBe(tPanel.errorCodes.job_running);
  });
});

describe("ServiceStartButton", () => {
  test("renders the service-specific label", () => {
    const html = (service: "pm2" | "postgres") => renderToStaticMarkup(createElement(ServiceStartButton, { service }));
    expect(html("pm2")).toContain("Start pm2");
    expect(html("postgres")).toContain("Start postgres");
  });
});
