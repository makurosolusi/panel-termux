import { EyeIcon, EyeOffIcon, PlusIcon, XIcon } from "lucide-react";
import { type ReactElement, useState } from "react";
import { DataTable } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { applyPaste, type PasteEntry, parseEnvPaste, pasteApplicable } from "./env.paste";
import { type EnvDraft, type EnvRow, envRowErrors, newEnvRow } from "./env.rows";

const t = idSiteDetail.env;

type SecretInputProps = {
  id: string;
  value: string;
  placeholder?: string;
  label: string;
  onChange: (v: string) => void;
};

/** Password input with a show/hide toggle (`aria-pressed`). */
export function SecretInput({ id: inputId, value, placeholder, label, onChange }: SecretInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative flex-1">
      <Input
        id={inputId}
        aria-label={label}
        type={shown ? "text" : "password"}
        autoComplete="new-password"
        className="pr-9 pointer-coarse:pr-12"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5 pointer-coarse:top-0 pointer-coarse:right-0"
        aria-label={shown ? t.hide : t.show}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </Button>
    </div>
  );
}

/** Editable KEY/value rows with per-row validation; `existing` keys count as duplicates, `locked` keys are refused. */
export function EnvRowsEditor({
  rows,
  existing,
  locked,
  onChange,
}: {
  rows: EnvRow[];
  existing?: readonly string[];
  locked?: readonly string[];
  onChange: (rows: EnvRow[]) => void;
}) {
  const errors = envRowErrors(rows, existing, locked);
  const update = (rowId: number, patch: Partial<EnvRow>) =>
    onChange(rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2 [&>button]:self-start">
      {rows.map((r, i) => {
        const err = errors[i];
        return (
          <div key={r.id} className="flex flex-col gap-1">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={t.key}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `env-error-${r.id}` : undefined}
                placeholder={t.key}
                className="font-mono sm:w-48"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                value={r.key}
                onChange={(e) => update(r.id, { key: e.target.value })}
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
            {err && (
              <p id={`env-error-${r.id}`} className="text-xs text-danger">
                {t.errors[err]}
              </p>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, newEnvRow()])}>
        <PlusIcon aria-hidden />
        {t.add}
      </Button>
    </div>
  );
}

const p = idSiteDetail.paste;

/** "Tempel .env": textarea → masked preview with per-line problems → merge the applicable lines into the draft. */
export function EnvPasteDialog({
  trigger,
  onApply,
  ...ctx
}: {
  trigger: ReactElement;
  existing: readonly string[];
  locked: readonly string[];
  pm2: readonly string[];
  onApply: (merge: (draft: EnvDraft) => EnvDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const entries = parseEnvPaste(text, ctx);
  const apply = () => {
    onApply((draft) => applyPaste(draft, entries));
    setOpen(false);
    setText("");
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription>{p.body}</DialogDescription>
        </DialogHeader>
        <textarea
          aria-label={p.label}
          rows={6}
          autoComplete="off"
          spellCheck={false}
          className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {text.trim() !== "" && (
          <DataTable<PasteEntry>
            label={p.preview}
            rows={entries}
            rowKey={(e) => String(e.line)}
            rowTone={(e) => (e.action === "skip" ? "danger" : e.problems.length > 0 ? "warning" : undefined)}
            empty={<p className="text-sm text-muted-foreground">{p.nothing}</p>}
            columns={[
              { key: "key", header: p.cols.key, mobile: "title", cell: (e) => <code>{e.key || p.line(e.line)}</code> },
              { key: "action", header: p.cols.action, mobile: "badge", cell: (e) => p.actions[e.action] },
              {
                key: "value",
                header: p.cols.value,
                cell: (e) => (e.action === "skip" ? "–" : p.masked(e.value.length)),
              },
              { key: "problems", header: p.cols.problems, cell: (e) => e.problems.map((x) => p.problems[x]).join(" ") },
            ]}
          />
        )}
        <p className="text-xs text-muted-foreground">{p.note}</p>
        <DialogFooter>
          <Button type="button" disabled={pasteApplicable(entries) === 0} onClick={apply}>
            {p.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
