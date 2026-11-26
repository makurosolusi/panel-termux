import { ChevronDownIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import type { BackupItem, BackupRun } from "@/shared/backup.types";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";
import { StatusBadge } from "@/web/panel/status.badge";
import { formatBytes, formatDateTime } from "@/web/shared/format";
import { backupItemDownloadUrl } from "./backup.api";
import { runTone } from "./backup.state";

const t = id.backup.runs;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t.copied);
  } catch {
    toast.error(t.copyFailed); // clipboard needs https and permission; the command stays visible to copy by hand
  }
}

function ItemRow({ run, item, index }: { run: BackupRun; item: BackupItem; index: number }) {
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.kinds[item.kind]}</span>
        <span className="mr-auto break-all">{item.name}</span>
        <span className="text-muted-foreground">
          {item.sizeBytes === null ? t.noSize : formatBytes(item.sizeBytes)}
        </span>
        <StatusBadge tone={item.ok ? "ok" : "bad"} label={item.ok ? t.statuses.succeeded : t.statuses.failed} />
        {item.ok && (
          <Button asChild variant="outline" size="sm">
            <a href={backupItemDownloadUrl(run.id, index)}>
              <DownloadIcon aria-hidden />
              {t.download}
            </a>
          </Button>
        )}
      </div>
      {item.error && <span className="break-words text-destructive">{item.error}</span>}
      {item.ok && item.restoreHint && (
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 text-xs break-all">{item.restoreHint}</code>
          <Button variant="ghost" size="icon-sm" aria-label={t.copy} onClick={() => void copy(item.restoreHint)}>
            <CopyIcon aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

/** One run as a native <details>: summary line, expandable items with download and restore command. */
export function BackupRunRow({ run }: { run: BackupRun }) {
  return (
    <details className="group py-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        <span className="mr-auto flex min-w-0 flex-col">
          <span>{formatDateTime(run.startedAt)}</span>
          <span className="text-xs text-muted-foreground">
            {t.triggers[run.trigger]} · {t.items(run.items.length)}
          </span>
        </span>
        <StatusBadge tone={runTone(run.status)} label={t.statuses[run.status]} />
      </summary>
      {run.error && <p className="mt-2 text-sm break-words text-destructive">{run.error}</p>}
      <ul className="mt-2 divide-y pl-6">
        {run.items.map((item, i) => (
          <ItemRow key={item.key} run={run} item={item} index={i} />
        ))}
      </ul>
    </details>
  );
}
