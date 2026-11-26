import { EllipsisIcon, Loader2Icon, PlayIcon, RotateCwIcon, ScrollTextIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { idPanel } from "@/web/i18n/id.panel";
import { type ControlTarget, controlPlan } from "./panel.control";
import type { PanelControl } from "./use-panel-control";

const t = idPanel;

/** Consequence lines of a confirmation: the generic sentence, then the service/site specific impact. */
function consequences(target: ControlTarget, action: "stop" | "restart"): string[] {
  const name = target.item.name;
  const lines = [t.confirmBodies[action](name)];
  if (target.kind === "services") {
    const impact = t.serviceImpact[name];
    if (impact) lines.push(impact);
  } else if (action === "stop" && target.item.site) {
    lines.push(t.confirmBodies.siteStop(target.item.site));
  }
  return lines;
}

const Body = ({ lines }: { lines: string[] }) => (
  <>
    {lines.map((l) => (
      <span key={l}>{l}</span>
    ))}
  </>
);

/** Row actions of a service/app: primary Mulai / Mulai ulang, then ⋯ with Hentikan and Lihat log (PLAN/02 §4.3). */
export function UnitActions({
  target,
  control,
  logTo,
}: {
  target: ControlTarget;
  control: PanelControl;
  logTo: string;
}) {
  const name = target.item.name;
  const plan = controlPlan(target);
  const [stopOpen, setStopOpen] = useState(false);
  const busy = control.pending !== null;
  const mine = control.pending === name;
  const stopTier = plan.tiers.stop;
  const codes = t.errorCodes;

  const primary =
    plan.primary === "start" ? (
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => control.runNow(name, "start")}>
        {mine ? <Loader2Icon className="motion-safe:animate-spin" aria-hidden /> : <PlayIcon aria-hidden />}
        {t.actions.start}
      </Button>
    ) : (
      <ConfirmAction
        trigger={
          <Button size="sm" variant="secondary" disabled={busy}>
            {mine ? <Loader2Icon className="motion-safe:animate-spin" aria-hidden /> : <RotateCwIcon aria-hidden />}
            {t.actions.restart}
          </Button>
        }
        title={t.confirmTitle.restart(name)}
        description={<Body lines={consequences(target, "restart")} />}
        confirmLabel={t.actions.restart}
        codes={codes}
        onConfirm={() => control.run(name, "restart")}
      />
    );

  const stopProps = {
    open: stopOpen,
    onOpenChange: setStopOpen,
    title: t.confirmTitle.stop(name),
    description: <Body lines={consequences(target, "stop")} />,
    confirmLabel: t.actions.stop,
    destructive: true,
    codes,
  };

  return (
    <>
      {primary}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t.more(name)} title={t.more(name)}>
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          {stopTier !== "hidden" && (
            <DropdownMenuItem
              variant="destructive"
              disabled={stopTier === "locked" || busy}
              onSelect={() => setStopOpen(true)}
            >
              <SquareIcon aria-hidden />
              {t.actions.stop}
            </DropdownMenuItem>
          )}
          {stopTier === "locked" && <p className="px-2 pb-2 text-xs text-muted-foreground">{t.lockoutReason(name)}</p>}
          <DropdownMenuItem asChild>
            <Link to={logTo}>
              <ScrollTextIcon aria-hidden />
              {t.viewLog}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {stopTier === "typed" && (
        <ConfirmAction
          {...stopProps}
          tier="typed"
          typedValue={name}
          onConfirm={(typed) => control.run(name, "stop", typed)}
        />
      )}
      {stopTier === "confirm" && <ConfirmAction {...stopProps} onConfirm={() => control.run(name, "stop")} />}
    </>
  );
}
