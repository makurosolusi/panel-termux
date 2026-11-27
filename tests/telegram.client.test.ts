import { afterAll, describe, expect, test } from "bun:test";
import { ALERT_COPY, buildDigest, DIGEST_MAX_CHARS, escapeHtml } from "@/server/alerts/alert.messages";
import { createTelegramClient, redactToken, splitText, TelegramError } from "@/server/alerts/telegram.client";
import { problem } from "@/server/panel/overview.rules";

const TOKEN = "123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ab"; // test-only fake token

type Call = { method: string; body: Record<string, unknown> };
const calls: Call[] = [];
let reply: (c: Call) => Response = () => Response.json({ ok: true, result: {} });
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const [, bot, method = ""] = new URL(req.url).pathname.split("/");
    if (bot !== `bot${TOKEN}`) return Response.json({ ok: false, description: "Not Found" }, { status: 404 });
    const call = { method, body: (await req.json()) as Record<string, unknown> };
    calls.push(call);
    return reply(call);
  },
});
afterAll(() => server.stop(true));

const client = (over: Partial<Parameters<typeof createTelegramClient>[0]> = {}) =>
  createTelegramClient({ token: TOKEN, baseUrl: server.url.origin, ...over });
const fail = (status: number, description: string, parameters?: object) => () =>
  Response.json({ ok: false, error_code: status, description, parameters }, { status });

async function errorOf(p: Promise<unknown>): Promise<TelegramError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof TelegramError) return e;
    throw e;
  }
  throw new Error("expected a TelegramError");
}

describe("sendMessage", () => {
  test("posts HTML, silent flag and disabled link preview", async () => {
    calls.length = 0;
    reply = () => Response.json({ ok: true, result: { message_id: 1 } });
    expect(await client().sendMessage("-100", "<b>x</b>", { silent: true })).toBe("-100");
    expect(calls).toEqual([
      {
        method: "sendMessage",
        body: {
          chat_id: "-100",
          text: "<b>x</b>",
          parse_mode: "HTML",
          disable_notification: true,
          link_preview_options: { is_disabled: true },
        },
      },
    ]);
  });

  test.each([
    [401, "Unauthorized", undefined, "telegram_token_invalid"],
    [400, "Bad Request: chat not found", undefined, "telegram_chat_not_found"],
    [403, "Forbidden: bot was blocked by the user", undefined, "telegram_forbidden"],
    [409, "Conflict: can't use getUpdates method while webhook is active", undefined, "telegram_conflict"],
    [400, "Bad Request: can't parse entities", undefined, "telegram_bad_request"],
    [502, "Bad Gateway", undefined, "telegram_unreachable"],
  ] as const)("HTTP %p %p → %p", async (status, description, parameters, code) => {
    reply = fail(status, description, parameters);
    const e = await errorOf(client().sendMessage("1", "x"));
    expect(e.code).toBe(code);
    expect(e.message).toContain(String(status));
  });

  test("429 carries retry_after (default 60)", async () => {
    reply = fail(429, "Too Many Requests: retry after 7", { retry_after: 7 });
    expect((await errorOf(client().sendMessage("1", "x"))).retryAfterSec).toBe(7);
    reply = fail(429, "Too Many Requests");
    expect((await errorOf(client().sendMessage("1", "x"))).retryAfterSec).toBe(60);
  });

  test("chat migrated → callback with the new id, retried once on it", async () => {
    calls.length = 0;
    reply = (c) =>
      c.body.chat_id === "-1"
        ? fail(400, "Bad Request: group chat was upgraded to a supergroup chat", { migrate_to_chat_id: -1009 })()
        : Response.json({ ok: true, result: {} });
    const saved: string[] = [];
    const used = await client().sendMessage("-1", "x", { onChatMigrated: (id) => void saved.push(id) });
    expect(used).toBe("-1009");
    expect(saved).toEqual(["-1009"]);
    expect(calls.map((c) => c.body.chat_id)).toEqual(["-1", "-1009"]);
  });

  test("timeout and network errors → telegram_unreachable, token redacted", async () => {
    reply = () => new Response(new ReadableStream({ start() {} })); // never ends the body
    const slow = await errorOf(client({ timeoutMs: 50 }).sendMessage("1", "x"));
    expect(slow.code).toBe("telegram_unreachable");
    const leaky = (async (url: string) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    }) as unknown as typeof fetch;
    const net = await errorOf(client({ fetch: leaky }).sendMessage("1", "x"));
    expect(net.code).toBe("telegram_unreachable");
    expect(net.message).toContain("ECONNREFUSED");
    for (const e of [slow, net]) {
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).not.toContain(TOKEN.split(":")[1] ?? "");
    }
  });

  test("text above 4096 chars is split at line breaks", async () => {
    calls.length = 0;
    reply = () => Response.json({ ok: true, result: {} });
    const line = "a".repeat(1000);
    await client().sendMessage("1", Array(6).fill(line).join("\n"));
    expect(calls.map((c) => (c.body.text as string).length)).toEqual([4003, 2001]);
    expect(splitText("b".repeat(5000))).toEqual(["b".repeat(4096), "b".repeat(904)]);
  });
});

describe("listChats", () => {
  test("chats from message, channel_post and my_chat_member, unique, without offset", async () => {
    calls.length = 0;
    reply = () =>
      Response.json({
        ok: true,
        result: [
          { update_id: 1, message: { chat: { id: 42, type: "private", first_name: "Malik", last_name: "K" } } },
          { update_id: 2, message: { chat: { id: 42, type: "private", first_name: "Malik" } } },
          { update_id: 3, channel_post: { chat: { id: -1001, type: "channel", title: "Ops" } } },
          { update_id: 4, my_chat_member: { chat: { id: -5, type: "group", title: "Tim" } } },
        ],
      });
    expect(await client().listChats()).toEqual([
      { id: "42", title: "Malik", type: "private" },
      { id: "-1001", title: "Ops", type: "channel" },
      { id: "-5", title: "Tim", type: "group" },
    ]);
    expect(calls[0]?.method).toBe("getUpdates");
    expect(calls[0]?.body.offset).toBeUndefined();
  });

  test("409 (webhook set) → telegram_conflict", async () => {
    reply = fail(409, "Conflict: can't use getUpdates method while webhook is active");
    expect((await errorOf(client().listChats())).code).toBe("telegram_conflict");
  });
});

describe("redaction and digest text", () => {
  test("redactToken removes the exact token and anything token-shaped", () => {
    expect(redactToken(`https://api.telegram.org/bot${TOKEN}/sendMessage`, TOKEN)).toBe(
      "https://api.telegram.org/bot***/sendMessage",
    );
    expect(redactToken("other 987654:abcdefghijklmnopqrstuvwxyz0123456789", "")).toBe("other ***");
  });

  test("escapeHtml and digest escaping of problem text", () => {
    expect(escapeHtml(`a<b>&"c"`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
    const p = problem("service_down", "<x&y>", "danger");
    const text = buildDigest([{ type: "open", problem: p, sinceSec: 180 }], "https://p.test/", "en");
    expect(text).toBe(
      "<b>Panel Termux</b> · p.test\nCRITICAL · Service &lt;x&amp;y&gt; is down · since 3 min\n\nOpen Overview: https://p.test/panel",
    );
  });

  test("alerts.language=id renders the digest, overflow and test texts in Indonesian", () => {
    const p = problem("service_down", "web", "danger");
    expect(buildDigest([{ type: "open", problem: p, sinceSec: 180 }], "https://p.test", "id")).toBe(
      "<b>Panel Termux</b> · p.test\nGAWAT · Layanan web mati · sejak 3 mnt\n\nBuka Ringkasan: https://p.test/panel",
    );
    const remind = buildDigest([{ type: "remind", problem: p, sinceSec: 90_000 }], "https://p.test", "id");
    expect(remind).toContain("MASIH · GAWAT · Layanan web mati · sejak 1 hari 1 jam");
    expect(buildDigest([{ type: "recovered", problem: p, durationSec: 60 }], "https://p.test", "id")).toContain(
      "PULIH · Layanan web mati · berlangsung 1 mnt",
    );
    expect(ALERT_COPY.id.overflow).toBe("Terlalu banyak notifikasi. Buka Ringkasan untuk melihat semuanya.");
    expect(ALERT_COPY.id.test).toStartWith("Notifikasi uji dari Panel Termux.");
    expect(ALERT_COPY.en.overflow).toBe("Too many alerts. Open Overview to see them all.");
    expect(ALERT_COPY.en.test).toStartWith("Test message from Panel Termux.");
  });

  test("digest caps at 15 lines and 3,500 chars with '… and N more'", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      type: "open" as const,
      problem: problem("service_down", `svc-${i}`, "danger"),
      sinceSec: 0,
    }));
    const lines = buildDigest(items, "https://p.test", "en").split("\n");
    expect(lines).toHaveLength(1 + 15 + 1 + 2);
    expect(lines[16]).toBe("… and 25 more");
    expect(buildDigest(items, "https://p.test", "id").split("\n")[16]).toBe("… dan 25 lainnya");
    const long = items.map((it, i) => ({
      ...it,
      problem: problem("service_down", `${"x".repeat(400)}${i}`, "danger"),
    }));
    const text = buildDigest(long, "https://p.test", "en");
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(text).toMatch(/… and \d+ more/);
  });
});
