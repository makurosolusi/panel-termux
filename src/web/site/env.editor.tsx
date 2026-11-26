import { EyeIcon, EyeOffIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { id } from "@/web/i18n/id";
import { type EnvRow, envRowErrors } from "./env.rows";

const t = id.site.env;
let nextRowId = 1;

/** New blank row with a unique id. */
export const blankEnvRow = (): EnvRow => ({ id: nextRowId++, key: "", value: "" });

/** Password input with a show/hide toggle. */
export function SecretInput({
  id: inputId,
  value,
  placeholder,
  label,
  onChange,
}: {
  id: string;
  value: string;
  placeholder?: string;
  label: string;
  onChange: (v: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative flex-1">
      <Input
        id={inputId}
        aria-label={label}
        type={shown ? "text" : "password"}
        autoComplete="new-password"
        className="pr-9"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5"
        aria-label={shown ? t.hide : t.show}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </Button>
    </div>
  );
}

/** Editable KEY/value rows with per-row key validation; `existing` keys count as duplicates. */
export function EnvRowsEditor({
  rows,
  existing,
  onChange,
}: {
  rows: EnvRow[];
  existing?: readonly string[];
  onChange: (rows: EnvRow[]) => void;
}) {
  const errors = envRowErrors(rows, existing);
  const update = (rowId: number, patch: Partial<EnvRow>) =>
    onChange(rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const err = errors[i];
        return (
          <div key={r.id} className="flex flex-col gap-1">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={t.key}
                aria-invalid={err ? true : undefined}
                placeholder={t.key}
                className="font-mono sm:w-48"
                autoCapitalize="characters"
                value={r.key}
                onChange={(e) => update(r.id, { key: e.target.value.toUpperCase() })}
              />
              <div className="flex flex-1 gap-2">
                <SecretInput
                  id={`env-value-${r.id}`}
                  label={`${t.value} ${r.key}`}
                  placeholder={t.value}
                  value={r.value}
                  onChange={(value) => update(r.id, { value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t.remove(r.key)}
                  onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                >
                  <XIcon aria-hidden />
                </Button>
              </div>
            </div>
            {err && <p className="text-xs text-destructive">{t.errors[err]}</p>}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...rows, blankEnvRow()])}
      >
        <PlusIcon aria-hidden />
        {t.add}
      </Button>
    </div>
  );
}
