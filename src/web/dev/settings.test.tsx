// Connection tests in the card footers (PLAN/05 §5.2, §5.5): Cloudflare token, S3 bucket (saved or draft), Telegram.
import { cn } from "cn";
import { Loader2Icon, MessageSquareIcon, PlugZapIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BackupVerify } from "@/shared/backup.types";
import type { CloudflareVerify } from "@/shared/dev.types";
import type { TelegramChat, TelegramChats } from "@/shared/monitor.types";
import { TONE_CLASS } from "@/web/components/status.tone";
import { Button } from "@/web/components/ui/button";
import { idSettings } from "@/web/i18n/id.settings";
import { ApiError } from "@/web/shared/api.client";
import { devFetch, devUrl } from "./dev.api";
import type { SettingGroup } from "./settings.registry";
import { cloudflareOutcome, type Drafts, s3Draft, s3Outcome, type TestOutcome, testFailure } from "./settings.state";

const t = idSettings.test;

/** Cards that have a connection test. */
const TESTABLE: readonly SettingGroup[] = ["cloudflare", "backup", "alerts"];
const MIGRATED = "telegram_chat_migrated";

/** Shown result of a test; `migrated` = Telegram moved the group and the server saved the new chat id. */
type TestResult = { outcome: TestOutcome; s3?: BackupVerify; migrated?: boolean };

/** Runs one test and maps it to an outcome (plus S3 steps). Network/API failures become a danger outcome. */
async function runTest(group: SettingGroup, drafts: Drafts): Promise<TestResult> {
  try {
    if (group === "cloudflare")
      return { outcome: cloudflareOutcome(await devFetch<CloudflareVerify>("POST", devUrl("/cloudflare/verify"))) };
    if (group === "backup") {
      const draft = s3Draft(drafts);
      const r = await devFetch<BackupVerify>(
        "POST",
        devUrl("/backup/verify"),
        Object.keys(draft).length ? draft : undefined,
      );
      return { outcome: s3Outcome(r), s3: r };
    }
    await devFetch("POST", devUrl("/alerts/test"));
    return { outcome: { tone: "success", text: t.telegramSent } };
  } catch (err) {
    return { outcome: testFailure(err), migrated: err instanceof ApiError && err.code === MIGRATED };
  }
}

/**
 * Footer test of a card: button, result (`role="status"`), S3 steps, and for Telegram "Cari chat". `autoRun`
 * increments after a save that changed connection keys; `onPickChat` fills the chat id draft.
 */
export function ConnectionTest({
  group,
  drafts,
  dirty,
  autoRun,
  onPickChat,
  onReload,
}: {
  group: SettingGroup;
  drafts: Drafts;
  dirty: boolean;
  autoRun: number;
  onPickChat: (id: string) => void;
  onReload: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [chats, setChats] = useState<TelegramChat[] | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const run = async () => {
    setPending(true);
    const r = await runTest(group, draftsRef.current);
    setPending(false);
    setResult(r);
    if (r.migrated) onReload();
  };
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (autoRun > 0) void runRef.current();
  }, [autoRun]);

  const findChats = async () => {
    setPending(true);
    try {
      setChats((await devFetch<TelegramChats>("POST", devUrl("/alerts/telegram/chats"))).chats);
    } catch (err) {
      setResult({ outcome: testFailure(err) });
    } finally {
      setPending(false);
    }
  };

  if (!TESTABLE.includes(group)) return null;
  const label = group === "cloudflare" ? t.cloudflareButton : group === "backup" ? t.s3Button : t.telegramButton;
  const usesDraft = group === "backup" && dirty;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run()}>
          {pending ? <Loader2Icon className="motion-safe:animate-spin" aria-hidden /> : <PlugZapIcon aria-hidden />}
          {pending ? t.running : label}
        </Button>
        {group === "alerts" && (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void findChats()}>
            <SearchIcon aria-hidden />
            {t.findChats}
          </Button>
        )}
        {dirty && <span className="text-xs text-muted-foreground">{usesDraft ? t.draftValues : t.savedValues}</span>}
      </div>
      <div role="status" className="empty:hidden">
        {result && <OutcomeLine result={result} />}
      </div>
      {chats && <ChatList chats={chats} onPick={onPickChat} />}
    </div>
  );
}

function OutcomeLine({ result }: { result: TestResult }) {
  const { outcome, s3 } = result;
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm", TONE_CLASS[outcome.tone])}>
      <p>{outcome.text}</p>
      {s3 && (
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {s3.steps.map((s) => (
            <li key={s.step}>
              {t.steps[s.step]}: {t.stepState[s.code === "skipped" ? "skipped" : s.ok ? "ok" : "failed"]}
            </li>
          ))}
        </ol>
      )}
      {outcome.detail && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t.detail}</summary>
          <code className="mt-1 block font-mono break-all">{outcome.detail}</code>
        </details>
      )}
    </div>
  );
}

function ChatList({ chats, onPick }: { chats: TelegramChat[]; onPick: (id: string) => void }) {
  if (chats.length === 0) return <p className="text-xs text-muted-foreground">{t.noChats}</p>;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium">{t.chatsTitle}</p>
      <ul className="divide-y rounded-md border">
        {chats.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="text-xs text-muted-foreground">{t.chatType[c.type]}</span>
            <code className="font-mono text-xs text-muted-foreground">{c.id}</code>
            <Button type="button" size="sm" variant="ghost" onClick={() => onPick(c.id)}>
              {t.useChat}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
