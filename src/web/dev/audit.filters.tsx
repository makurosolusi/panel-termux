import { XIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { idDevAudit } from "@/web/i18n/id.dev.audit";
import { AUDIT_PREFIXES, isAuditFiltered } from "./audit.describe";

const t = idDevAudit;
const ALL = "all";

/** Local calendar date input ("Dari"/"Sampai"); value is YYYY-MM-DD as the API expects. */
function DateFilter({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (v: string | null) => void;
}) {
  const inputId = useId();
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <label htmlFor={inputId}>{label}</label>
      <Input
        id={inputId}
        type="date"
        className="h-8 w-38 pointer-coarse:h-11"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(ev) => onChange(ev.target.value || null)}
      />
    </div>
  );
}

/** Audit toolbar: action group, date range, actor chip, clear. Every change goes through `setFilter` (URL params). */
export function AuditFilters({
  params,
  setFilter,
  onClear,
  actorName,
  badRange,
}: {
  params: URLSearchParams;
  setFilter: (key: string, value: string | null) => void;
  onClear: () => void;
  actorName: string | null;
  badRange: boolean;
}) {
  const actorId = params.get("actorId");
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select value={params.get("action") ?? ALL} onValueChange={(v) => setFilter("action", v === ALL ? null : v)}>
        <SelectTrigger size="sm" className="w-40 pointer-coarse:h-11" aria-label={t.actionFilter}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t.prefixes.all}</SelectItem>
          {AUDIT_PREFIXES.map((p) => (
            <SelectItem key={p} value={p}>
              {t.prefixes[p as keyof typeof t.prefixes]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(["from", "to"] as const).map((key) => (
        <DateFilter
          key={key}
          label={t[key]}
          value={params.get(key) ?? ""}
          invalid={badRange}
          onChange={(v) => setFilter(key, v)}
        />
      ))}
      {actorId && (
        <Button variant="secondary" size="sm" onClick={() => setFilter("actorId", null)} aria-label={t.removeActor}>
          {t.actorChip(actorName ?? actorId)}
          <XIcon aria-hidden />
        </Button>
      )}
      {isAuditFiltered(params) && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <XIcon aria-hidden />
          {t.clearFilters}
        </Button>
      )}
    </div>
  );
}
