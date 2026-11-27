import { afterEach, describe, expect, test } from "bun:test";
import { tSecurity } from "@/web/i18n/en.security";
import { settingLabel } from "@/web/security/data-key.card";
import { attachmentName, isReauthRequired, SECURITY_ERROR_CODES, sensitiveFetch } from "@/web/security/security.api";
import { accessState, dataKeyStatusKey } from "@/web/security/security.state";
import { ApiError, apiErrorMessage, errorFromResponse, REAUTH_REQUIRED } from "@/web/shared/api.client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const stubFetch = (res: Response) => {
  globalThis.fetch = (async () => res) as unknown as typeof fetch;
};

describe("security state", () => {
  test("access row", () => {
    expect(accessState({ https: false, lastSeenAt: "2026-11-26T00:00:00Z" })).toBe("not_https");
    expect(accessState({ https: true, lastSeenAt: "2026-11-26T00:00:00Z" })).toBe("seen");
    expect(accessState({ https: true, lastSeenAt: null })).toBe("not_seen");
  });
  test("data key badge", () => {
    expect(dataKeyStatusKey("ok")).toBe("succeeded");
    expect(dataKeyStatusKey("mismatch")).toBe("key_mismatch");
  });
  test("unreadable settings use the settings labels, unknown keys stay raw", () => {
    expect(settingLabel("cloudflare.api_token")).toBe("Token API Cloudflare");
    expect(settingLabel("x.unknown")).toBe("x.unknown");
  });
});

describe("security api", () => {
  test("attachment name", () => {
    expect(attachmentName('attachment; filename="panel-termux-kunci-data-2026-11-27.txt"', "f")).toBe(
      "panel-termux-kunci-data-2026-11-27.txt",
    );
    expect(attachmentName(null, "f")).toBe("f");
  });

  test("403 reauth_required is thrown as is (no /login navigation, which needs window)", async () => {
    stubFetch(Response.json({ error: REAUTH_REQUIRED, message: "sign in again" }, { status: 403 }));
    const err = await sensitiveFetch("POST", "/api/dev/security/data-key/export").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isReauthRequired(err)).toBe(true);
    expect(apiErrorMessage(err, SECURITY_ERROR_CODES)).toBe(tSecurity.errorCodes.reauth_required);
  });

  test("ok response is returned for blob reading", async () => {
    stubFetch(new Response("key", { status: 200, headers: { "content-disposition": 'attachment; filename="k.txt"' } }));
    const res = await sensitiveFetch("POST", "/x");
    expect(await res.text()).toBe("key");
  });

  test("other 4xx codes map to security copy", () => {
    expect(isReauthRequired(errorFromResponse(409, { error: "key_mismatch" }))).toBe(false);
    expect(apiErrorMessage(errorFromResponse(400, { error: "confirm_mismatch" }), SECURITY_ERROR_CODES)).toBe(
      tSecurity.errorCodes.confirm_mismatch,
    );
  });

  test("network failure is an ApiError network", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    const err = await sensitiveFetch("GET", "/x").catch((e: unknown) => e);
    expect(err instanceof ApiError && err.kind).toBe("network");
  });

  test("copy", () => {
    expect(tSecurity.sessions.summary(3, 2)).toBe(
      "3 sesi aktif dari 2 pengguna. Sesi berakhir paling lama 30 hari setelah masuk.",
    );
    expect(tSecurity.dataKey.resetBody(["Token API Cloudflare"])).toStartWith("Token API Cloudflare dihapus");
    expect(tSecurity.dataKey.resetWord).toBe("hapus");
  });
});
