import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { DevSetting, SettingKey } from "@/shared/dev.types";
import { CodeText } from "@/web/components/code-text";
import { useNow } from "@/web/components/now.store";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { idSettings, type SettingFieldCopy } from "@/web/i18n/id.settings";
import { SecretField } from "./secret.field";
import { fieldDef, OFF, ON } from "./settings.registry";
import { choiceLabel, fieldStatus, shownValue, statusLabel } from "./settings.state";

const t = idSettings;

/** Props shared by the field controls. */
export type FieldProps = {
  setting: DevSetting;
  draft: string;
  onDraft: (v: string) => void;
  /** Inline error text under the control (from PATCH `fields`). */
  error?: string;
  disabled?: boolean;
  /** "Hapus" of a stored secret (PATCH `{ key: null }`). */
  onRemove: () => Promise<unknown>;
};

/** One setting: label (+ `*`), technical key, status, control, help + "Cara membuatnya", inline error. */
export function SettingField(props: FieldProps) {
  const { setting, error } = props;
  const key = setting.key as SettingKey;
  const def = fieldDef(key);
  const copy: SettingFieldCopy = t.fields[key];
  const now = useNow();
  const status = fieldStatus(setting);
  const inputId = `setting-${key}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const described = [helpId, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {copy.label}
          {def.required && (
            <>
              <span className="text-danger" aria-hidden>
                {" *"}
              </span>
              <span className="sr-only">{` (${t.required})`}</span>
            </>
          )}
        </label>
        <StatusBadge tone={status.tone} label={statusLabel(status, now)} />
        <code className="font-mono text-[11px] text-muted-foreground">{key}</code>
      </div>
      {def.control === "secret" ? (
        <SecretField {...props} inputId={inputId} describedBy={described} />
      ) : (
        <PlainControl {...props} inputId={inputId} describedBy={described} />
      )}
      <p id={helpId} className="text-xs text-muted-foreground">
        {status.kind === "unreadable" ? `${t.secret.unreadableBody} ` : null}
        <CodeText>{copy.help}</CodeText>
        {def.helpUrl && (
          <>
            {" "}
            <a
              href={def.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="relative inline-flex items-center gap-0.5 font-medium text-brand-text underline-offset-4 hover:underline pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:content-['']"
            >
              {t.helpLink}
              <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
          </>
        )}
      </p>
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger">
          <CodeText>{error}</CodeText>
        </p>
      )}
    </div>
  );
}

/** Non-secret control: text/number input, switch, select, or number with an on/off switch. */
function PlainControl({
  setting,
  draft,
  onDraft,
  error,
  disabled,
  inputId,
  describedBy,
}: FieldProps & { inputId: string; describedBy: string }) {
  const key = setting.key as SettingKey;
  const def = fieldDef(key);
  const shown = shownValue(setting, draft);
  const aria = { id: inputId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined };
  const reset = setting.isSet && setting.default != null && (
    <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => onDraft("")}>
      {t.reset}
    </Button>
  );
  let control: ReactNode;
  if (def.control === "switch")
    control = (
      <Switch {...aria} checked={shown === ON} disabled={disabled} onCheckedChange={(on) => onDraft(on ? ON : OFF)} />
    );
  else if (def.control === "select")
    control = (
      <Select value={shown} onValueChange={onDraft} disabled={disabled}>
        <SelectTrigger {...aria} className="w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {def.choices?.map((c) => (
            <SelectItem key={c} value={c}>
              {choiceLabel(key, c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  else {
    const off = def.control === "numberOrOff" && shown === OFF;
    const numeric = def.control === "number" || def.control === "numberOrOff";
    control = (
      <div className="flex items-center gap-3">
        <Input
          {...aria}
          value={off ? "" : draft}
          disabled={disabled || off}
          onChange={(e) => onDraft(e.target.value)}
          placeholder={
            setting.default && setting.default !== OFF
              ? t.defaultIs(setting.default)
              : (t.fields[key] as SettingFieldCopy).placeholder
          }
          inputMode={numeric ? "numeric" : undefined}
          autoComplete="off"
          spellCheck={false}
          className={numeric ? "w-full sm:w-40" : "w-full font-mono text-sm"}
        />
        {def.control === "numberOrOff" && (
          <span className="flex shrink-0 items-center gap-2 text-sm">
            <Switch
              checked={!off}
              disabled={disabled}
              aria-label={t.fields[key].label}
              onCheckedChange={(on) => onDraft(on ? "" : OFF)}
            />
            {off ? t.options.off : t.options.on}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {control}
      {reset}
    </div>
  );
}
