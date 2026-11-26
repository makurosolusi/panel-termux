import { Loader2Icon, PlayIcon, RotateCwIcon, SquareIcon } from "lucide-react";
import { CONTROL_ACTIONS, type ControlAction } from "@/shared/panel.types";
import { Button } from "@/web/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { id } from "@/web/i18n/id";
import { ConfirmAction } from "@/web/shared/confirm.dialog";
import { type BlockReason, dropsAllDomains } from "./panel.status";

const t = id.panel;
const ICON = { start: PlayIcon, stop: SquareIcon, restart: RotateCwIcon } as const;

/** Start/stop/restart buttons for one unit; each asks for confirmation, blocked ones explain why in a tooltip. */
export function ControlButtons({
  name,
  blocks,
  pending,
  onRun,
}: {
  name: string;
  blocks: Record<ControlAction, BlockReason>;
  /** The action currently in flight for this unit (spinner), if any. */
  pending: ControlAction | null;
  onRun: (action: ControlAction) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CONTROL_ACTIONS.map((action) => {
        const reason = blocks[action];
        const label = t.actions[action];
        const Icon = pending === action ? Loader2Icon : ICON[action];
        const button = (
          <Button variant={action === "stop" ? "outline" : "secondary"} size="sm" disabled={reason !== null}>
            <Icon className={pending === action ? "animate-spin" : undefined} aria-hidden />
            {label}
          </Button>
        );
        if (reason !== null) {
          return (
            <Tooltip key={action}>
              <TooltipTrigger asChild>
                {/* disabled buttons swallow pointer events; the span keeps the tooltip reachable (also via Tab) */}
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus target for the tooltip explaining the disabled button */}
                <span tabIndex={0}>{button}</span>
              </TooltipTrigger>
              <TooltipContent>{t.blocked[reason]}</TooltipContent>
            </Tooltip>
          );
        }
        return (
          <ConfirmAction
            key={action}
            trigger={button}
            title={t.confirmTitle(label, name)}
            confirmLabel={label}
            destructive={action === "stop"}
            onConfirm={() => onRun(action)}
            description={
              <>
                <span>{t.confirmBody(label, name)}</span>
                {dropsAllDomains(name, action) && <strong className="text-destructive">{t.tunnelWarning}</strong>}
              </>
            }
          />
        );
      })}
    </div>
  );
}
