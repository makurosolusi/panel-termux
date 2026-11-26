import { RotateCcwIcon, SaveIcon } from "lucide-react";
import { useState } from "react";
import type { DevSetting, DevSettingPut } from "@/shared/dev.types";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { id } from "@/web/i18n/id";
import { formatDateTime } from "@/web/shared/format";
import { CLOUDFLARE_TOKEN_KEY, CloudflareVerifyButton } from "./cloudflare.verify";
import { devFetch, devUrl, runDevAction } from "./dev.api";
import { canReset, initialDraft, RESET_BODY, saveBody, settingStatus } from "./settings.state";

const t = id.dev.settings;

/** One setting row: input, save, and reset (plain) / clear (secret, write-only — the value is never shown). */
export function SettingField({ setting, onSaved }: { setting: DevSetting; onSaved: () => void }) {
  const [draft, setDraft] = useState(() => initialDraft(setting));
  const [pending, setPending] = useState(false);
  const body = saveBody(setting, draft);
  const status = settingStatus(setting);
  const inputId = `setting-${setting.key}`;

  const put = async (payload: DevSettingPut, success: string) => {
    setPending(true);
    let next: DevSetting | undefined;
    const ok = await runDevAction(async () => {
      next = await devFetch<DevSetting>("PUT", devUrl(`/settings/${encodeURIComponent(setting.key)}`), payload);
    }, success);
    setPending(false);
    if (ok && next) {
      setDraft(initialDraft(next));
      onSaved();
    }
  };

  return (
    <form
      className="flex flex-col gap-2 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (body) void put(body, t.savedToast(setting.label));
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={inputId}>{setting.label}</Label>
        <Badge variant={status === "notSet" || status === "default" ? "outline" : "secondary"}>
          {t.status[status]}
        </Badge>
        <code className="text-xs text-muted-foreground">{setting.key}</code>
      </div>
      <p className="text-sm text-muted-foreground">{setting.description}</p>
      <div className="flex gap-2">
        <Input
          id={inputId}
          type={setting.secret ? "password" : "text"}
          autoComplete={setting.secret ? "new-password" : "off"}
          value={draft}
          placeholder={setting.secret ? t.replacePlaceholder : undefined}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={pending || !body} aria-label={`${t.save} ${setting.label}`}>
          <SaveIcon aria-hidden />
          <span className="sr-only sm:not-sr-only">{t.save}</span>
        </Button>
        {canReset(setting) && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            aria-label={`${setting.secret ? t.clear : t.reset}: ${setting.label}`}
            title={setting.secret ? t.clear : t.reset}
            onClick={() => void put(RESET_BODY, t.resetToast(setting.label))}
          >
            <RotateCcwIcon aria-hidden />
          </Button>
        )}
      </div>
      {setting.key === CLOUDFLARE_TOKEN_KEY && <CloudflareVerifyButton />}
      {setting.updatedAt && (
        <p className="text-xs text-muted-foreground">{t.updatedAt(formatDateTime(setting.updatedAt))}</p>
      )}
    </form>
  );
}
