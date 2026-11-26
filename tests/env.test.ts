import { describe, expect, test } from "bun:test";
import { EnvError, parseEnv } from "@/server/env";

// test-only dummy values
const base = {
  APP_BASE_URL: "https://panel.test",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "s3cr3t-value",
  SUPER_ADMIN_EMAILS: " A@Example.com , b@test.io ,",
};

describe("parseEnv", () => {
  test("applies defaults and normalizes emails", () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3200);
    expect(env.PANEL_DATA_DIR).toBe("./data");
    expect(env.SUPER_ADMIN_EMAILS).toEqual(["a@example.com", "b@test.io"]);
  });

  test.each(["APP_BASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SUPER_ADMIN_EMAILS"])(
    "missing %s throws naming it",
    (name) => {
      expect(() => parseEnv({ ...base, [name]: "" })).toThrow(new RegExp(name));
    },
  );

  test("rejects invalid email without echoing it", () => {
    try {
      parseEnv({ ...base, SUPER_ADMIN_EMAILS: "ok@x.io,not-an-email" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as Error).message).toContain("#2");
      expect((e as Error).message).not.toContain("not-an-email");
    }
  });

  test("rejects bad URL and port", () => {
    expect(() => parseEnv({ ...base, APP_BASE_URL: "ftp://x" })).toThrow(/APP_BASE_URL/);
    expect(() => parseEnv({ ...base, PORT: "70000" })).toThrow(/PORT/);
  });

  test("secret value never appears in error messages", () => {
    expect(() => parseEnv({ ...base, APP_BASE_URL: "" })).not.toThrow(/s3cr3t/);
  });
});
