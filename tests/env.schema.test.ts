import { describe, expect, test } from "bun:test";
import { type Env, EnvError, parseEnv } from "@/server/env";
import { CONNECTIVITY_PROBE_URL } from "@/server/monitor/monitor.service";
import { findEnvLine } from "@/shared/env.codec";
import { ENV_VARS, type EnvVar, type EnvVarName, isEnvValueMissing, renderEnvTemplate } from "@/shared/env.schema";

// test-only dummy values
const valid = {
  APP_BASE_URL: "https://panel.test",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "s3cr3t-value",
  SUPER_ADMIN_EMAILS: "a@test.io",
};
// test-only: the two sample lines of `.env.example` as shipped in 0.4.0 (debate D7).
const ENV_EXAMPLE_040 = "APP_BASE_URL=https://panel.example.com\nSUPER_ADMIN_EMAILS=you@example.com\n";

const vars: readonly EnvVar[] = ENV_VARS;
const byName = (name: EnvVarName): EnvVar => vars.find((v) => v.name === name) as EnvVar;
const requiredNames = vars.filter((v) => v.required).map((v) => v.name);

// Compile-time: schema names and the Env type keys are the same set.
const sameKeys: [EnvVarName] extends [keyof Env] ? ([keyof Env] extends [EnvVarName] ? true : false) : false = true;

describe("ENV_VARS", () => {
  test("names match the keys parseEnv returns, without duplicates", () => {
    expect(sameKeys).toBe(true);
    const names = vars.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.toSorted()).toEqual(Object.keys(parseEnv(valid)).toSorted());
  });

  test("required = exactly the vars whose absence makes parseEnv throw", () => {
    const throwing = vars
      .filter((v) => {
        try {
          parseEnv({ ...valid, [v.name]: "" });
          return false;
        } catch (e) {
          expect(e).toBeInstanceOf(EnvError);
          return true;
        }
      })
      .map((v) => v.name);
    expect(throwing).toEqual(requiredNames);
    expect(requiredNames).toEqual(["APP_BASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SUPER_ADMIN_EMAILS"]);
  });

  test("defaults equal parseEnv's result for unset vars", () => {
    const env = parseEnv(valid);
    expect(byName("PORT").default).toBe(String(env.PORT));
    expect(byName("PANEL_DATA_DIR").default).toBe(env.PANEL_DATA_DIR);
    expect(byName("PANEL_CONNECTIVITY_URL").default).toBe(CONNECTIVITY_PROBE_URL);
    expect(env.PANEL_SKIP_SNAPSHOT).toBe(false);
    expect(parseEnv({ ...valid, PANEL_SKIP_SNAPSHOT: byName("PANEL_SKIP_SNAPSHOT").default }).PANEL_SKIP_SNAPSHOT).toBe(
      false,
    );
    for (const v of vars) expect(v.required ? v.default === undefined : v.default !== undefined).toBe(true);
  });

  test("secrets have no example; every var has a one-line description", () => {
    for (const v of vars) {
      if (v.secret) expect(v.example).toBeUndefined();
      expect(v.description).not.toContain("\n");
      expect(v.description.length).toBeGreaterThan(0);
    }
    expect(byName("GOOGLE_CLIENT_SECRET").secret).toBe(true);
    expect(byName("GOOGLE_CLIENT_SECRET").description).toContain("Rahasia");
  });

  test("placeholders are the 0.4.0 .env.example sample values", () => {
    expect(byName("APP_BASE_URL").placeholders).toEqual([findEnvLine(ENV_EXAMPLE_040, "APP_BASE_URL") ?? ""]);
    expect(byName("SUPER_ADMIN_EMAILS").placeholders).toEqual([
      findEnvLine(ENV_EXAMPLE_040, "SUPER_ADMIN_EMAILS") ?? "",
    ]);
    expect(vars.filter((v) => v.placeholders).map((v) => v.name)).toEqual(["APP_BASE_URL", "SUPER_ADMIN_EMAILS"]);
  });
});

describe("isEnvValueMissing", () => {
  test("empty, blank and placeholder count as missing; real values do not", () => {
    const url = byName("APP_BASE_URL");
    expect(isEnvValueMissing(url, undefined)).toBe(true);
    expect(isEnvValueMissing(url, null)).toBe(true);
    expect(isEnvValueMissing(url, "  ")).toBe(true);
    expect(isEnvValueMissing(url, " https://panel.example.com ")).toBe(true);
    expect(isEnvValueMissing(url, "https://panel.test")).toBe(false);
    expect(isEnvValueMissing(byName("SUPER_ADMIN_EMAILS"), "you@example.com")).toBe(true);
    expect(isEnvValueMissing(byName("GOOGLE_CLIENT_ID"), "you@example.com")).toBe(false);
  });
});

describe("renderEnvTemplate", () => {
  const minimal = [
    "# Panel Termux — .env minimal. Isi nilai yang kosong, simpan sebagai ~/panel/.env (chmod 600).",
    "# Pengaturan lain (Cloudflare, backup, Telegram, situs, monitor) ada di /dev → Pengaturan. Panduan: panel docs google",
    "",
    "# Alamat publik panel (https://domain, atau http://localhost:<port> saat lokal). Contoh: https://panel.contoh.com",
    "APP_BASE_URL=",
    "# Client ID OAuth Google (tipe Web application). Contoh: 1234-abcd.apps.googleusercontent.com",
    "GOOGLE_CLIENT_ID=",
    "# Client secret OAuth Google. Rahasia: jangan dibagikan atau di-commit.",
    "GOOGLE_CLIENT_SECRET=",
    "# Email Google yang menjadi super admin, pisahkan dengan koma. Contoh: kamu@contoh.com",
    "SUPER_ADMIN_EMAILS=",
  ];
  const optional = [
    "",
    "# --- Opsional: hapus tanda # untuk mengubah nilai bawaan ---",
    "# Port panel (selalu listen di 127.0.0.1 saja).",
    "# PORT=3200",
    "# Folder panel.db dan secret (cadangkan!). Relatif ke working directory.",
    "# PANEL_DATA_DIR=./data",
    '# URL yang dicek monitor untuk membedakan "tidak ada internet" dari "situs mati".',
    "# PANEL_CONNECTIVITY_URL=https://www.gstatic.com/generate_204",
    "# 1 = migrasi tetap jalan walau snapshot panel.db gagal (mis. disk penuh). Hanya untuk satu kali start, lalu hapus.",
    "# PANEL_SKIP_SNAPSHOT=0",
  ];

  test("minimal = PLAN §6.2 text: 4 required keys, empty values", () => {
    expect(renderEnvTemplate({ full: false })).toBe(`${minimal.join("\n")}\n`);
  });

  test("full = minimal + optional vars commented out at their defaults", () => {
    expect(renderEnvTemplate({ full: true })).toBe(`${[...minimal, ...optional].join("\n")}\n`);
  });

  test("never prints placeholders, has no version header, every schema key appears once", () => {
    const full = renderEnvTemplate({ full: true });
    for (const p of vars.flatMap((v) => v.placeholders ?? [])) expect(full).not.toContain(p);
    expect(full.split("\n", 2).join("\n")).not.toMatch(/\d+\.\d+/);
    for (const v of vars) expect(full.match(new RegExp(`^(# )?${v.name}=`, "gm"))?.length).toBe(1);
  });
});
