import { cn } from "cn";
import { ClipboardPasteIcon, RotateCwIcon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { EnvValueProblem } from "@/shared/env.codec";
import type { JobAccepted, SiteDetail, SiteEnvSaved, SiteEnvUpdate } from "@/shared/site.types";
import { ActionBar } from "@/web/components/action-bar";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { useTaskMode } from "@/web/layout/task.mode";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch, type ErrorCodes } from "@/web/shared/api.client";
import { EnvPasteDialog, EnvRowsEditor } from "./env.editor";
import {
  type EnvDraft,
  type EnvKeyBadge,
  emptyEnvDraft,
  envDraftCounts,
  envDraftSavable,
  envKeyBadges,
  envUpdateBody,
  lockedKeysOf,
  replacedErrors,
  toggleUnset,
} from "./env.rows";
import { SecretInput } from "./env.secret-input";
import { jobPath, siteUrl } from "./site.api";
import { canRestart } from "./site.card";

const t = idSiteDetail.env;

const BADGE_CLASS: Record<EnvKeyBadge | "new", string> = {
  locked: "border-border text-muted-foreground",
  pm2: "border-warning/25 bg-warning-subtle text-warning",
  replace: "border-info/25 bg-info-subtle text-info",
  new: "border-success/25 bg-success-subtle text-success",
  unset: "border-danger/25 bg-danger-subtle text-danger",
};

/** Small state pill of an env key ("Diatur panel", "akan diganti", …). */
export function EnvBadge({ kind }: { kind: EnvKeyBadge | "new" }) {
  return (
    <Badge variant="outline" className={cn("font-normal", BADGE_CLASS[kind])}>
      {t.badges[kind]}
    </Badge>
  );
}

/** One key already in the site's .env: badges, write-only replacement input and remove/undo (none when locked). */
export function ExistingKeyRow(props: {
  name: string;
  badges: EnvKeyBadge[];
  value: string;
  error?: EnvValueProblem;
  disabled?: boolean;
  onChange: (v: string) => void;
  onToggleUnset: () => void;
}) {
  const { name, badges, error } = props;
  const locked = badges.includes("locked");
  const removed = badges.includes("unset");
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:w-64 sm:pt-2">
        <code className={cn("text-sm break-all", removed && "text-muted-foreground line-through")}>{name}</code>
        {badges.map((b) => (
          <EnvBadge key={b} kind={b} />
        ))}
      </div>
      {locked ? (
        <p className="flex-1 text-xs text-muted-foreground sm:pt-2.5">{t.lockedHelp}</p>
      ) : (
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center justify-end gap-2">
            {!removed && (
              <SecretInput
                id={`env-replace-${name}`}
                label={`${t.replace} ${name}`}
                placeholder={t.replacePlaceholder}
                value={props.value}
                onChange={props.onChange}
              />
            )}
            <Button type="button" variant="ghost" size="sm" disabled={props.disabled} onClick={props.onToggleUnset}>
              {removed ? <Undo2Icon aria-hidden /> : <Trash2Icon aria-hidden />}
              {removed ? t.undo : t.unset}
              <span className="sr-only">{name}</span>
            </Button>
          </div>
          {badges.includes("pm2") && <p className="text-xs text-warning">{t.pm2Help}</p>}
          {error && <p className="text-xs text-danger">{t.errors[error]}</p>}
        </div>
      )}
    </li>
  );
}

type EditorProps = { site: SiteDetail; busy: boolean; codes: ErrorCodes; onSaved: () => void };

/**
 * Write-only `.env` editor (PLAN/03 §4.10/§5.6): replace or remove existing keys, add rows, paste a `.env`. "Simpan"
 * writes the file (restart pending); "Simpan dan mulai ulang" runs job `site.env`, which restores the old file when the
 * app turns unhealthy.
 */
export function SiteEnvEditor({ site, busy, codes, onSaved }: EditorProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<EnvDraft>(emptyEnvDraft);
  const [pending, setPending] = useState(false);
  const locked = lockedKeysOf(site);
  const pm2 = site.pm2EnvKeys ?? [];
  const counts = envDraftCounts(draft);
  const dirty = counts.replaced + counts.added + counts.unset > 0 || draft.rows.length > 0;
  const savable = !busy && !pending && envDraftSavable(draft, site.envKeys, locked);
  const valueErrors = replacedErrors(draft);
  useTaskMode(dirty);

  const save = async (restart: boolean) => {
    setPending(true);
    const body: SiteEnvUpdate = { ...envUpdateBody(draft.replaced, draft.unset, draft.rows), restart };
    try {
      const res = await apiFetch<SiteEnvSaved | JobAccepted>("PUT", siteUrl(site.name, "/env"), body);
      setDraft(emptyEnvDraft());
      if ("jobId" in res) return navigate(jobPath(res.jobId));
      toast.success(t.saved);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, codes), { duration: ERROR_TOAST_MS });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 [&>button]:self-start [&>button]:px-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.description}</p>
        <EnvPasteDialog
          existing={site.envKeys}
          locked={locked}
          pm2={pm2}
          onApply={setDraft}
          trigger={
            <Button type="button" variant="outline" size="sm" disabled={busy}>
              <ClipboardPasteIcon aria-hidden />
              {idSiteDetail.paste.open}
            </Button>
          }
        />
      </div>
      {site.envKeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border px-3">
          {site.envKeys.map((key) => (
            <ExistingKeyRow
              key={key}
              name={key}
              badges={envKeyBadges(key, draft, locked, pm2)}
              value={draft.replaced[key] ?? ""}
              error={valueErrors[key]}
              disabled={busy}
              onChange={(v) => setDraft({ ...draft, replaced: { ...draft.replaced, [key]: v } })}
              onToggleUnset={() => setDraft(toggleUnset(draft, key))}
            />
          ))}
        </ul>
      )}
      {draft.rows.length > 0 && <EnvBadge kind="new" />}
      <EnvRowsEditor
        rows={draft.rows}
        existing={site.envKeys}
        locked={locked}
        onChange={(rows) => setDraft({ ...draft, rows })}
      />
      {dirty && (
        <>
          <Button type="button" variant="link" size="sm" onClick={() => setDraft(emptyEnvDraft())}>
            {t.discard}
          </Button>
          <p className="text-xs text-muted-foreground">{canRestart(site) ? t.saveRestartHint : t.noRestart}</p>
          <ActionBar>
            <span aria-live="polite" className="mr-auto text-sm text-muted-foreground max-sm:hidden">
              {t.summary(counts.replaced, counts.added, counts.unset)}
            </span>
            <Button type="button" variant="outline" disabled={!savable} onClick={() => void save(false)}>
              <SaveIcon aria-hidden />
              {t.save}
            </Button>
            <Button type="button" disabled={!savable || !canRestart(site)} onClick={() => void save(true)}>
              <RotateCwIcon aria-hidden />
              {t.saveRestart}
            </Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
