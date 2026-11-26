import { AlertTriangleIcon, SaveIcon } from "lucide-react";
import { useState } from "react";
import type { SiteDetail, SiteEnvUpdate } from "@/shared/site.types";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
import { Label } from "@/web/components/ui/label";
import { id } from "@/web/i18n/id";
import { apiFetch } from "@/web/shared/api.client";
import { EnvRowsEditor, SecretInput } from "./env.editor";
import { type EnvRow, envRowsValid, envUpdateBody, envUpdateEmpty, RESERVED_ENV_KEYS } from "./env.rows";
import { runSiteAction, siteUrl } from "./site.api";

const t = id.site.envEditor;

/** Write-only .env editor: replace values, mark keys to unset, add new rows; saving restarts the app. */
export function SiteEnvEditor({ site, onSaved }: { site: SiteDetail; onSaved: () => void }) {
  const [replaced, setReplaced] = useState<Record<string, string>>({});
  const [unset, setUnset] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [pending, setPending] = useState(false);
  const body = envUpdateBody(replaced, unset, rows);
  const canSave = !pending && !envUpdateEmpty(body) && envRowsValid(rows, site.envKeys);

  const toggleUnset = (key: string, on: boolean) => {
    const next = new Set(unset);
    if (on) next.add(key);
    else next.delete(key);
    setUnset(next);
  };

  const save = async () => {
    setPending(true);
    const ok = await runSiteAction(
      () => apiFetch<{ envKeys: string[] }>("PUT", siteUrl(site.name, "/env"), body satisfies SiteEnvUpdate),
      t.saved,
    );
    setPending(false);
    if (!ok) return;
    setReplaced({});
    setUnset(new Set());
    setRows([]);
    onSaved();
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save();
      }}
    >
      <p className="text-sm text-muted-foreground">{t.description}</p>
      {site.envKeys.length === 0 && <p className="text-sm text-muted-foreground">{t.noKeys}</p>}
      <ul className="flex flex-col gap-2">
        {site.envKeys.map((key) => {
          const reserved = RESERVED_ENV_KEYS.includes(key);
          const removed = unset.has(key);
          return (
            <li key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className={`text-sm sm:w-48 ${removed ? "line-through text-muted-foreground" : ""}`}>{key}</code>
              {reserved ? (
                <span className="flex-1 text-xs text-muted-foreground">{id.site.env.errors.reserved}</span>
              ) : (
                <div className="flex flex-1 items-center gap-3">
                  <SecretInput
                    id={`env-replace-${key}`}
                    label={`${t.replacePlaceholder} ${key}`}
                    placeholder={t.replacePlaceholder}
                    value={removed ? "" : (replaced[key] ?? "")}
                    onChange={(v) => setReplaced({ ...replaced, [key]: v })}
                  />
                  <Label className="flex items-center gap-1.5 text-xs font-normal">
                    <Checkbox checked={removed} onCheckedChange={(c) => toggleUnset(key, c === true)} />
                    {t.unset}
                  </Label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <EnvRowsEditor rows={rows} existing={site.envKeys} onChange={setRows} />
      <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
        {t.restartWarning}
      </p>
      <Button type="submit" className="self-start" disabled={!canSave}>
        <SaveIcon aria-hidden />
        {t.save}
      </Button>
    </form>
  );
}
