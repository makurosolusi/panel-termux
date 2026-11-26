import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addApp, appNames, removeApp } from "@/server/sites/apps.file";
import { assertEnvEntries, EnvInputError, envKeys, envLine, updateEnv } from "@/server/sites/env.file";
import {
  IngressEditError,
  ingressHostnames,
  insertIngressRule,
  readTunnelId,
  removeIngressRule,
} from "@/server/sites/ingress.editor";
import { readTextOrNull, restoreText, writeAtomic } from "@/server/sites/site.files";
import { createTermuxPostgres } from "@/server/system/postgres.termux";

const sandbox = mkdtempSync(join(tmpdir(), "panel-site-files-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

// test-only: shaped like the phone's ~/.cloudflared/config.yml (ids are dummies)
const REAL_CONFIG = `tunnel: 6f1c2d3e-aaaa-bbbb-cccc-1234567890ab
credentials-file: /data/data/com.termux/files/home/.cloudflared/6f1c2d3e-aaaa-bbbb-cccc-1234567890ab.json

# hand-written; panel inserts above the catch-all
ingress:
  - hostname: solusi.malikkurosaki.com
    service: http://localhost:3005
    originRequest:
      noTLSVerify: true
  # admin db ui
  - hostname: "db.malikkurosaki.com"
    service: http://localhost:3006
  - service: http_status:404
`;

describe("ingress editor", () => {
  test("reads tunnel id and hostnames", () => {
    expect(readTunnelId(REAL_CONFIG)).toBe("6f1c2d3e-aaaa-bbbb-cccc-1234567890ab");
    // On the phone `tunnel:` is the tunnel name; the UUID is only in the credentials file name.
    const named = REAL_CONFIG.replace(/^tunnel: .*$/m, "tunnel: poco");
    expect(readTunnelId(named)).toBe("6f1c2d3e-aaaa-bbbb-cccc-1234567890ab");
    expect(
      readTunnelId("tunnel: poco\ncredentials-file: /x/creds.json\ningress:\n  - service: http_status:404\n"),
    ).toBeNull();
    expect(ingressHostnames(REAL_CONFIG)).toEqual(["solusi.malikkurosaki.com", "db.malikkurosaki.com"]);
  });

  test("insert goes right above the catch-all, rest of the file byte-identical", () => {
    const out = insertIngressRule(REAL_CONFIG, "shop.example.com", "http://localhost:3010");
    expect(out).toBe(
      REAL_CONFIG.replace(
        "  - service: http_status:404",
        "  - hostname: shop.example.com\n    service: http://localhost:3010\n  - service: http_status:404",
      ),
    );
    expect(ingressHostnames(out)).toEqual(["solusi.malikkurosaki.com", "db.malikkurosaki.com", "shop.example.com"]);
  });

  test("remove drops only that rule (multi-line, quoted) and round-trips to the original", () => {
    const added = insertIngressRule(REAL_CONFIG, "shop.example.com", "http://localhost:3010");
    expect(removeIngressRule(added, "shop.example.com")).toBe(REAL_CONFIG);
    const noSolusi = removeIngressRule(REAL_CONFIG, "solusi.malikkurosaki.com");
    expect(noSolusi).not.toContain("noTLSVerify");
    expect(noSolusi).toContain("# admin db ui");
    expect(ingressHostnames(removeIngressRule(noSolusi, "db.malikkurosaki.com"))).toEqual([]);
    expect(removeIngressRule(REAL_CONFIG, "absent.example.com")).toBe(REAL_CONFIG);
  });

  test("zero-indent list style works", () => {
    const flat =
      "tunnel: t\ningress:\n- hostname: a.example.com\n  service: http://localhost:1\n- service: http_status:404\n";
    const out = insertIngressRule(flat, "b.example.com", "http://localhost:2");
    expect(ingressHostnames(out)).toEqual(["a.example.com", "b.example.com"]);
    expect(removeIngressRule(out, "a.example.com")).toBe(
      "tunnel: t\ningress:\n- hostname: b.example.com\n  service: http://localhost:2\n- service: http_status:404\n",
    );
  });

  test("refuses unsafe shapes", () => {
    expect(() => insertIngressRule(REAL_CONFIG, "db.malikkurosaki.com", "http://localhost:1")).toThrow(
      IngressEditError,
    );
    const noCatchAll = "tunnel: t\ningress:\n  - hostname: a.example.com\n    service: http://localhost:1\n";
    expect(() => insertIngressRule(noCatchAll, "b.example.com", "http://localhost:2")).toThrow(/catch-all/);
    expect(() => insertIngressRule("tunnel: t\n", "b.example.com", "x")).toThrow(/no ingress/);
    expect(() => insertIngressRule("ingress:\n  [{service: http_status:404}]\n", "b.example.com", "x")).toThrow(
      /block list/,
    );
  });
});

describe(".env helpers", () => {
  test("quotes non-trivial values, rejects unrepresentable ones", () => {
    expect(envLine("A", "plain-value_1.2:3@x")).toBe("A=plain-value_1.2:3@x");
    expect(envLine("B", 'has space "q" $HOME')).toBe("B='has space \"q\" \\$HOME'");
    for (const v of ["it's", "a\nb", "a\rb", "end\\"]) expect(() => assertEnvEntries({ K: v })).toThrow(EnvInputError);
    expect(() => assertEnvEntries({ "1BAD": "x" })).toThrow(/invalid env key/);
    expect(() => assertEnvEntries({ K: 5 })).toThrow(/string/);
  });

  test("written values load back exactly through Bun's .env parser", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${HOME} is the case under test
    const values = ['p@ss "w" $HOME ${HOME} \\ mid', "x\\$HOME", "a\\nb", "#notcomment", "=eq= ", "$"];
    const dir = join(sandbox, "envcheck");
    mkdirSync(dir);
    writeFileSync(join(dir, ".env"), `${values.map((v, i) => envLine(`V${i}`, v)).join("\n")}\n`);
    writeFileSync(
      join(dir, "print.ts"),
      `process.stdout.write(JSON.stringify(${JSON.stringify(values.map((_, i) => `V${i}`))}.map((k) => process.env[k])));`,
    );
    const p = Bun.spawn([process.execPath, "print.ts"], {
      cwd: dir,
      stdout: "pipe",
      env: { PATH: process.env.PATH, HOME: "/h" },
    });
    expect(JSON.parse(await new Response(p.stdout).text())).toEqual(values);
  });

  test("keys listed, set/unset keep comments and other keys", () => {
    const text = "# c\nPORT=3001\nexport TOKEN=abc\nOLD=1\n";
    expect(envKeys(text)).toEqual(["PORT", "TOKEN", "OLD"]);
    const out = updateEnv(text, { TOKEN: "new", NEWKEY: "x" }, ["OLD"]);
    expect(out).toBe("# c\nPORT=3001\nTOKEN=new\nNEWKEY=x\n");
    expect(updateEnv("", { A: "1" }, [])).toBe("A=1\n");
  });
});

describe("apps.json + atomic files", () => {
  const entry = { name: "shop", cwd: "/s/shop", script: "./app", interpreter: "none" as const, env: { PORT: "3010" } };

  test("add/remove keeps other entries", () => {
    const hand = JSON.stringify([{ name: "keep", script: "x" }]);
    const added = addApp(hand, entry);
    expect(appNames(added)).toEqual(["keep", "shop"]);
    expect(() => addApp(added, entry)).toThrow(/already/);
    expect(JSON.parse(removeApp(added, "shop"))).toEqual([{ name: "keep", script: "x" }]);
    expect(appNames(addApp(null, entry))).toEqual(["shop"]);
    expect(() => addApp('{"a":1}', entry)).toThrow(/array/);
  });

  test("writeAtomic sets mode, keeps .bak; restoreText puts back exact bytes or removes", () => {
    const p = join(sandbox, "f.txt");
    writeAtomic(p, "one", { mode: 0o600 });
    expect(statSync(p).mode & 0o777).toBe(0o600);
    writeAtomic(p, "two", { backup: true });
    expect(readFileSync(`${p}.bak`, "utf8")).toBe("one");
    restoreText(p, "one");
    expect(readTextOrNull(p)).toBe("one");
    restoreText(p, null);
    expect(readTextOrNull(p)).toBeNull();
  });
});

describe("termux postgres writes", () => {
  test("password goes through stdin, never argv; bad identifiers refused", async () => {
    const prefix = join(sandbox, "prefix");
    mkdirSync(join(prefix, "bin"), { recursive: true });
    const psql = join(prefix, "bin", "psql");
    // test-only fake psql: records argv and stdin
    writeFileSync(psql, `#!/bin/sh\necho "$@" > "${prefix}/argv"\ncat > "${prefix}/stdin"\n`);
    chmodSync(psql, 0o755);
    const old = process.env.PREFIX;
    process.env.PREFIX = prefix;
    try {
      const pg = createTermuxPostgres();
      await pg.createRoleAndDatabase("shop_x", "ab12".repeat(8));
      expect(readFileSync(join(prefix, "argv"), "utf8")).not.toContain("ab12");
      const script = readFileSync(join(prefix, "stdin"), "utf8");
      expect(script).toContain(`\\set pw '${"ab12".repeat(8)}'`);
      expect(script).toContain(`CREATE ROLE :"name" LOGIN PASSWORD :'pw';`);
      await pg.dropRoleAndDatabase("shop_x");
      expect(readFileSync(join(prefix, "stdin"), "utf8")).toContain('DROP DATABASE IF EXISTS :"name" WITH (FORCE);');
      await expect(pg.createRoleAndDatabase("bad-name", "ab12".repeat(8))).rejects.toThrow(/identifier/);
      await expect(pg.createRoleAndDatabase("ok", "x'; DROP")).rejects.toThrow(/hex/);
      await expect(pg.dropRoleAndDatabase("Robert')")).rejects.toThrow(/identifier/);
    } finally {
      process.env.PREFIX = old;
    }
  });
});
