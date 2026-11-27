import { EyeIcon, EyeOffIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { SettingKey } from "@/shared/dev.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { type SettingFieldCopy, tSettings } from "@/web/i18n/en.settings";
import type { FieldProps } from "./setting.field";

const t = tSettings.secret;

/**
 * Write-only secret (PLAN/05 §5.2): a stored value shows "Replace" / "Remove" and is never sent back to the browser;
 * "Ganti" opens an empty password input with a show toggle and "Batal". Not stored or unreadable → input right away.
 */
export function SecretField({
  setting,
  draft,
  onDraft,
  error,
  disabled,
  onRemove,
  inputId,
  describedBy,
}: FieldProps & { inputId: string; describedBy: string }) {
  const key = setting.key as SettingKey;
  const copy: SettingFieldCopy = tSettings.fields[key];
  const [replacing, setReplacing] = useState(false);
  const [visible, setVisible] = useState(false);
  const stored = setting.isSet && setting.readable !== false;
  const editing = replacing || !stored;

  const remove = setting.isSet && (
    <ConfirmAction
      title={t.removeTitle(copy.label)}
      description={key === "cloudflare.api_token" ? t.removeCloudflare : t.removeGeneric}
      confirmLabel={t.removeConfirm}
      destructive
      codes={tSettings.errorCodes}
      onConfirm={onRemove}
      successToast={tSettings.removed(copy.label)}
      trigger={
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Trash2Icon aria-hidden />
          {t.remove}
        </Button>
      }
    />
  );

  if (!editing)
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setReplacing(true)}>
          <PencilIcon aria-hidden />
          {t.replace}
        </Button>
        {remove}
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-64">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoFocus={replacing}
          value={draft}
          disabled={disabled}
          placeholder={copy.placeholder}
          onChange={(e) => onDraft(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className="pr-11 font-mono text-sm"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-pressed={visible}
          aria-label={t.show}
          title={t.show}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
        </Button>
      </div>
      {replacing && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onDraft("");
            setReplacing(false);
            setVisible(false);
          }}
        >
          {t.cancel}
        </Button>
      )}
      {!replacing && remove}
    </div>
  );
}
