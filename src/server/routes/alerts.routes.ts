// Telegram setup endpoints for super admins (PLAN/02 §3.7, §4.7): test send and chat discovery, under /dev/alerts.
import type { AlertTestResult, TelegramChats } from "../../shared/monitor.types";
import { TEST_TEXT } from "../alerts/alert.messages";
import { createTelegramClient, TELEGRAM_API_URL, TelegramError } from "../alerts/telegram.client";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import type { Db } from "../db/client";
import { log } from "../log.service";
import { type MonitorService, onChatMigrated } from "../monitor/monitor.service";
import { getSetting } from "../settings.service";
import { ApiError } from "./http.error";
import { panelOnError } from "./panel.routes";

/** At most one test send per this gap (429 `too_soon`). */
export const TEST_SEND_GAP_MS = 5_000;

/** Deps of createAlertRoutes; `telegramBaseUrl` points at a mock Bot API in tests. */
export type AlertRoutesDeps = { auth: Auth; db: Db; secret: string; monitor: MonitorService; telegramBaseUrl?: string };

/** Bot API failure → 502 with its AlertErrorCode; anything else is rethrown. */
function asApiError(e: unknown): never {
  if (e instanceof TelegramError) {
    log.warn(`[alerts] ${e.message}`);
    throw new ApiError(502, e.code, e.message);
  }
  throw e;
}

/** super_admin routes POST /dev/alerts/test and POST /dev/alerts/telegram/chats. */
export function createAlertRoutes({ auth, db, secret, monitor, telegramBaseUrl = TELEGRAM_API_URL }: AlertRoutesDeps) {
  let lastTestAt = Number.NEGATIVE_INFINITY;
  const client = (token: string) => createTelegramClient({ token, baseUrl: telegramBaseUrl });

  return roleGuard(auth, "/dev/alerts", "super_admin")
    .onError(panelOnError as never)
    .post("/test", async (): Promise<AlertTestResult> => {
      const token = getSetting({ db, secret }, "alerts.telegram_bot_token");
      const chat = getSetting({ db, secret }, "alerts.telegram_chat_id");
      if (!token || !chat) throw new ApiError(409, "alerts_not_configured", "set the bot token and chat id first");
      const wait = lastTestAt + TEST_SEND_GAP_MS - Date.now();
      if (wait > 0)
        throw new ApiError(429, "too_soon", "wait a moment before sending another test", {
          retryAfterSec: Math.ceil(wait / 1000),
        });
      lastTestAt = Date.now();
      await client(token)
        .sendMessage(chat, TEST_TEXT, { onChatMigrated: (id) => onChatMigrated({ db }, id) })
        .catch(asApiError);
      monitor.resetAlertFailures();
      return { ok: true, sentAt: new Date().toISOString() };
    })
    .post("/telegram/chats", async (): Promise<TelegramChats> => {
      const token = getSetting({ db, secret }, "alerts.telegram_bot_token");
      if (!token) throw new ApiError(409, "alerts_token_missing", "set the bot token first");
      return { chats: await client(token).listChats().catch(asApiError) };
    });
}
