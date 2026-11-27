import { ChevronDownIcon, Loader2Icon, SaveIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { DevSetting, SettingKey } from "@/shared/dev.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { idSettings } from "@/web/i18n/id.settings";
import { Notice, ReauthNotice } from "@/web/security/security.notice";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { ApiError, apiErrorMessage } from "@/web/shared/api.client";
import { toast } from "@/web/shared/toast.lazy";
import { DATA_KEY_ANCHOR } from "./onboarding.state";
import { SettingField } from "./setting.field";
import { fieldDef, GROUP_ANCHOR, type SettingGroup } from "./settings.registry";
import {
  changedValues,
  changesSitesDir,
  type Drafts,
  fieldErrorMessage,
  initialDraft,
  missingRequired,
  needsAutoTest,
  patchSettings,
  SettingsPatchError,
  saveFailure,
  turnsOnIncludeSecrets,
} from "./settings.state";
import { ConnectionTest } from "./settings.test";

const t = idSettings;
const DESKTOP_QUERY = "(min-width: 768px)";

/** One settings card: collapsible on phones, fields, connection test, and an atomic "Simpan" for the card. */
export function SettingsGroup({
  group,
  items,
  onSaved,
  onDirty,
  onReload,
}: {
  group: SettingGroup;
  items: DevSetting[];
  onSaved: (items: DevSetting[]) => void;
  onDirty: (group: SettingGroup, dirty: boolean) => void;
  onReload: () => void;
}) {
  const titleId = useId();
  const anchor = GROUP_ANCHOR[group];
  const copy = t.groups[group];
  const [edits, setEdits] = useState<Drafts>({});
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [notice, setNotice] = useState<"reauth" | "keyMismatch" | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [autoRun, setAutoRun] = useState(0);
  const draftOf = (s: DevSetting) => edits[s.key as SettingKey] ?? initialDraft(s);
  const drafts: Drafts = Object.fromEntries(items.map((s) => [s.key, draftOf(s)]));
  const values = changedValues(items, drafts);
  const dirty = Object.keys(values).length > 0;
  const incomplete = items.some((s) => missingRequired(s, !!fieldDef(s.key as SettingKey).required, draftOf(s)));
  const [open, setOpen] = useState(
    () => incomplete || window.location.hash === `#${anchor}` || window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => onDirty(group, dirty), [group, dirty, onDirty]);

  const edit = (key: SettingKey, v: string) => {
    setEdits((e) => ({ ...e, [key]: v }));
    setErrors(({ [key]: _, ...rest }) => rest);
  };

  const save = async (confirmed: boolean) => {
    if (!dirty || saving) return;
    if (!confirmed && (turnsOnIncludeSecrets(values, items) || changesSitesDir(values))) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    setErrors({});
    setNotice(null);
    try {
      onSaved(await patchSettings(values));
      setEdits({});
      toast.success(t.saved(copy.title));
      if (needsAutoTest(group, values)) setAutoRun((n) => n + 1);
    } catch (err) {
      const kind = saveFailure(err);
      if (kind === "fields" && err instanceof SettingsPatchError) {
        const next: Partial<Record<SettingKey, string>> = {};
        for (const [k, reason] of Object.entries(err.fields))
          if (reason) next[k as SettingKey] = fieldErrorMessage(k as SettingKey, reason);
        setErrors(next);
        toast.error(t.fieldErrors, { duration: ERROR_TOAST_MS });
      } else if (kind === "reauth" || kind === "keyMismatch") setNotice(kind);
      else {
        const network = err instanceof ApiError && err.kind === "network";
        toast.error(network ? t.saveFailed : apiErrorMessage(err, t.errorCodes), { duration: ERROR_TOAST_MS });
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (key: SettingKey) => {
    onSaved(await patchSettings({ [key]: null }));
    setEdits(({ [key]: _, ...rest }) => rest);
  };

  const includeSecrets = turnsOnIncludeSecrets(values, items);
  return (
    <section id={anchor} aria-labelledby={titleId} className="scroll-mt-20 rounded-lg border bg-card">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group/card">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-base font-semibold">
                {copy.title}
              </h2>
              {dirty && <StatusBadge tone="info" label={t.dirty} />}
              {incomplete && <StatusBadge tone="warning" label={t.incomplete} />}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{copy.description}</p>
          </div>
          <ChevronDownIcon
            className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open/card:rotate-180"
            aria-hidden
          />
        </summary>
        <form
          aria-labelledby={titleId}
          className="flex flex-col border-t"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <div className="divide-y px-4 py-4">
            {items.map((s) => (
              <SettingField
                key={`${s.key}:${s.updatedAt ?? ""}`}
                setting={s}
                draft={draftOf(s)}
                onDraft={(v) => edit(s.key as SettingKey, v)}
                error={errors[s.key as SettingKey]}
                disabled={saving}
                onRemove={() => remove(s.key as SettingKey)}
              />
            ))}
          </div>
          {notice && (
            <div className="px-4 pb-3">
              {notice === "reauth" ? (
                <ReauthNotice message={t.reauth} />
              ) : (
                <Notice
                  tone="danger"
                  alert
                  actions={
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/dev#${DATA_KEY_ANCHOR}`}>{t.keyMismatch.link}</Link>
                    </Button>
                  }
                >
                  <p>{t.keyMismatch.body}</p>
                </Notice>
              )}
            </div>
          )}
          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <ConnectionTest
              group={group}
              drafts={drafts}
              dirty={dirty}
              autoRun={autoRun}
              onPickChat={(chatId) => {
                edit("alerts.telegram_chat_id", chatId);
                toast.success(t.test.chatPicked);
              }}
              onReload={onReload}
            />
            <Button type="submit" size="sm" disabled={!dirty || saving} className="sm:ml-auto">
              {saving ? <Loader2Icon className="motion-safe:animate-spin" aria-hidden /> : <SaveIcon aria-hidden />}
              {saving ? t.saving : t.save}
            </Button>
          </div>
        </form>
      </details>
      <ConfirmAction
        open={confirming}
        onOpenChange={setConfirming}
        title={includeSecrets ? t.confirm.includeSecretsTitle : t.confirm.sitesDirTitle}
        description={includeSecrets ? t.confirm.includeSecretsBody : t.confirm.sitesDirBody}
        confirmLabel={includeSecrets ? t.confirm.includeSecretsButton : t.confirm.sitesDirButton}
        destructive={includeSecrets}
        onConfirm={async () => void save(true)}
      />
    </section>
  );
}
