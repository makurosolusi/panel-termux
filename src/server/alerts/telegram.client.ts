// Minimal Telegram Bot API client (PLAN/02 §3.8): sendMessage + getUpdates with error mapping. The bot token is part
// of every URL, so every error that leaves this file goes through redactToken first.
import type { AlertErrorCode, TelegramChat } from "../../shared/monitor.types";

/** Public Bot API endpoint (protocol constant); tests pass a local mock server. */
export const TELEGRAM_API_URL = "https://api.telegram.org";
/** Bot API limit for `text` after entity parsing. */
export const TELEGRAM_MAX_TEXT = 4096;
/** Per-request timeout. */
export const TELEGRAM_TIMEOUT_MS = 10_000;
/** Wait after a 429 without `retry_after`. */
export const TELEGRAM_DEFAULT_RETRY_SEC = 60;
const MAX_CHATS = 20;

const TOKEN_SHAPE = /\d{5,16}:[A-Za-z0-9_-]{30,64}/g;

/** Removes the bot token (exact value and anything token-shaped) from a text. */
export function redactToken(text: string, token: string): string {
  const exact = token ? text.split(token).join("***") : text;
  return exact.replace(TOKEN_SHAPE, "***");
}

/** A failed Bot API call; `message` never holds the token. */
export class TelegramError extends Error {
  constructor(
    readonly code: AlertErrorCode,
    message: string,
    readonly retryAfterSec: number | null = null,
    readonly migrateToChatId: string | null = null,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

type ApiReply = {
  ok?: boolean;
  result?: unknown;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

function mapError(
  status: number,
  reply: ApiReply,
): { code: AlertErrorCode; retry: number | null; migrate: string | null } {
  const p = reply.parameters ?? {};
  const desc = (reply.description ?? "").toLowerCase();
  if (status === 401 || status === 404) return { code: "telegram_token_invalid", retry: null, migrate: null };
  if (status === 403) return { code: "telegram_forbidden", retry: null, migrate: null };
  if (status === 409) return { code: "telegram_conflict", retry: null, migrate: null };
  if (status === 429)
    return { code: "telegram_rate_limited", retry: p.retry_after ?? TELEGRAM_DEFAULT_RETRY_SEC, migrate: null };
  if (status === 400 && p.migrate_to_chat_id !== undefined)
    return { code: "telegram_chat_migrated", retry: null, migrate: String(p.migrate_to_chat_id) };
  if (status === 400 && desc.includes("chat not found"))
    return { code: "telegram_chat_not_found", retry: null, migrate: null };
  if (status === 400) return { code: "telegram_bad_request", retry: null, migrate: null };
  return { code: "telegram_unreachable", retry: null, migrate: null };
}

/** Splits at line breaks so each part fits `max` characters; a single longer line is cut hard. */
export function splitText(text: string, max = TELEGRAM_MAX_TEXT): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    for (let i = 0; i < Math.max(line.length, 1); i += max) {
      const piece = line.slice(i, i + max);
      if (cur && cur.length + 1 + piece.length > max) {
        parts.push(cur);
        cur = piece;
      } else cur = cur ? `${cur}\n${piece}` : piece;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Options of createTelegramClient; `fetch`/`baseUrl` are for tests. */
export type TelegramClientOptions = { token: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number };

/** Options of sendMessage. `onChatMigrated` must persist the new id (setting + audit); the send is retried once. */
export type SendOptions = { silent?: boolean; onChatMigrated?: (newChatId: string) => void | Promise<void> };

/** Bot API client bound to one token. */
export function createTelegramClient({
  token,
  baseUrl = TELEGRAM_API_URL,
  fetch: doFetch = fetch,
  timeoutMs = TELEGRAM_TIMEOUT_MS,
}: TelegramClientOptions) {
  async function call(method: string, body: object): Promise<unknown> {
    let res: Response;
    let reply: ApiReply;
    try {
      res = await doFetch(`${baseUrl}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Non-JSON body (proxy error page): mapped by HTTP status below, a 200 without `ok` counts as unreachable.
      reply = (await res.json().catch(() => ({}))) as ApiReply;
    } catch (e) {
      const msg = redactToken(`telegram ${method} failed: ${(e as Error).message}`, token);
      throw new TelegramError("telegram_unreachable", msg);
    }
    if (res.ok && reply.ok) return reply.result;
    const { code, retry, migrate } = mapError(res.status, reply);
    const msg = redactToken(`telegram ${method} failed: HTTP ${res.status} ${reply.description ?? ""}`.trim(), token);
    throw new TelegramError(code, msg, retry, migrate);
  }

  async function sendOne(chatId: string, text: string, opts: SendOptions): Promise<string> {
    const body = (id: string) => ({
      chat_id: id,
      text,
      parse_mode: "HTML",
      disable_notification: opts.silent ?? false,
      link_preview_options: { is_disabled: true },
    });
    try {
      await call("sendMessage", body(chatId));
      return chatId;
    } catch (e) {
      if (!(e instanceof TelegramError) || !e.migrateToChatId) throw e;
      await opts.onChatMigrated?.(e.migrateToChatId);
      await call("sendMessage", body(e.migrateToChatId));
      return e.migrateToChatId;
    }
  }

  return {
    /** Sends HTML `text` (split above 4096 chars); resolves with the chat id used (new one after a migration). */
    async sendMessage(chatId: string, text: string, opts: SendOptions = {}): Promise<string> {
      let id = chatId;
      for (const part of splitText(text)) id = await sendOne(id, part, opts);
      return id;
    },

    /** Chats that wrote to the bot in the last 24 h (getUpdates without offset, so nothing is consumed). */
    async listChats(): Promise<TelegramChat[]> {
      const updates = (await call("getUpdates", { allowed_updates: ["message", "channel_post", "my_chat_member"] })) as
        | Record<string, { chat?: Record<string, unknown> } | undefined>[]
        | undefined;
      const chats = new Map<string, TelegramChat>();
      for (const u of updates ?? []) {
        for (const c of [u.message?.chat, u.channel_post?.chat, u.my_chat_member?.chat]) {
          if (!c || c.id === undefined || chats.size >= MAX_CHATS) continue;
          const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
          const t = (c.title ?? (name || c.username) ?? String(c.id)) as string;
          chats.set(String(c.id), { id: String(c.id), title: t, type: c.type as TelegramChat["type"] });
        }
      }
      return [...chats.values()];
    },
  };
}

/** A Bot API client (createTelegramClient). */
export type TelegramClient = ReturnType<typeof createTelegramClient>;
