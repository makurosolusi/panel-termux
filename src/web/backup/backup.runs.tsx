import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import type { BackupItem, BackupRun } from "@/shared/backup.types";
import { CopyButton } from "@/web/components/copy-button";
import { InlineCode } from "@/web/components/inline-code";
import { StatusBadge } from "@/web/components/status-badge";
import { tBackup } from "@/web/i18n/en.backup";
import { formatBytes, formatDateTime } from "@/web/shared/format";
import { ItemDownload } from "./backup.download";
import { canDownload, type DownloadAccess, SHA_PREVIEW_CHARS } from "./backup.state";
import { runStatusKey } from "./backup.status-key";

const t = tBackup;

/** "Diperiksa" (with the honest title) or muted "Belum diperiksa"; nothing for failed items. */
export function CheckedBadge({ checked }: { checked: boolean | null | undefined }) {
  if (checked)
    return (
      <span title={t.lastGood.checkedTitle} className="cursor-help">
        <StatusBadge state="succeeded" label={t.lastGood.checked} />
      </span>
    );
  return <span className="text-xs text-muted-foreground">{t.lastGood.unchecked}</span>;
}

/** Indonesian message of a failed item (by code, or `message`), with the masked technical detail below it. */
export function ItemError({ item, message }: { item: Pick<BackupItem, "error" | "errorCode">; message?: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-danger">{message ?? (item.errorCode ? t.itemErrors[item.errorCode] : t.itemFailed)}</span>
      {item.error && <span className="text-xs break-words text-muted-foreground">{item.error}</span>}
    </div>
  );
}

function ItemRow({
  run,
  item,
  index,
  access,
}: {
  run: BackupRun;
  item: BackupItem;
  index: number;
  access: DownloadAccess;
}) {
  const sha = item.sha256;
  return (
    <li className={cn("flex flex-col gap-2 py-3 text-sm", item.pruned && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{t.kinds[item.kind]}</span>
        <span className="mr-auto min-w-0 break-all text-muted-foreground">{item.name}</span>
        <span className="text-muted-foreground tabular-nums">
          {item.sizeBytes === null ? t.runs.noSize : formatBytes(item.sizeBytes)}
        </span>
        {item.pruned ? (
          <span className="text-xs text-muted-foreground">{t.runs.pruned}</span>
        ) : item.ok ? (
          <CheckedBadge checked={item.checked} />
        ) : (
          <StatusBadge state="failed" />
        )}
        {canDownload(item, access) && <ItemDownload runId={run.id} index={index} kind={item.kind} />}
      </div>
      {sha && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{t.runs.checksum}</span>
          <code className="font-mono" title={sha}>
            {sha.slice(0, SHA_PREVIEW_CHARS)}
          </code>
          <CopyButton value={sha} label={t.runs.copySha} />
        </div>
      )}
      {item.warning && (
        <StatusBadge tone="warning" label={t.itemWarnings[item.warning]} className="whitespace-normal" />
      )}
      {!item.ok && <ItemError item={item} />}
      {item.ok && !item.pruned && item.restoreHint && <InlineCode copy>{item.restoreHint}</InlineCode>}
    </li>
  );
}

/** One run as a native <details>: time, trigger, file count and status; expands to the items. */
export function BackupRunRow({ run, access }: { run: BackupRun; access: DownloadAccess }) {
  return (
    <details className="group py-3">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        <span className="mr-auto flex min-w-0 flex-col">
          <span>{formatDateTime(run.startedAt)}</span>
          <span className="text-xs text-muted-foreground">
            {t.runs.triggers[run.trigger]} · {t.runs.items(run.items.length)}
            {run.includesSecrets && ` · ${t.runs.secretsRun}`}
            {run.prunedAt && ` · ${t.runs.pruned}`}
          </span>
        </span>
        <StatusBadge state={runStatusKey(run)} />
      </summary>
      {run.error && <p className="mt-2 pl-6 text-xs break-words text-muted-foreground">{run.error}</p>}
      <ul className="mt-1 divide-y pl-6">
        {run.items.map((item, i) => (
          <ItemRow key={item.key} run={run} item={item} index={i} access={access} />
        ))}
      </ul>
    </details>
  );
}
