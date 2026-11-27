import { cn } from "cn";
import { CircleCheckIcon, CircleDashedIcon, ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";
import type { DevSetup, SetupItem, SetupItemKey } from "@/shared/dev.types";
import { CodeText } from "@/web/components/code-text";
import { InlineCode } from "@/web/components/inline-code";
import { Button } from "@/web/components/ui/button";
import { tDevSetup } from "@/web/i18n/en.dev.setup";
import {
  type ItemAction,
  itemAction,
  manualToggle,
  ONBOARDING_ANCHOR,
  SECRET_SCP_COMMAND,
  setupProgress,
  tickLabel,
  visibleItems,
} from "./onboarding.state";

const t = tDevSetup;

function ActionLink({ action }: { action: ItemAction }) {
  if (action.kind === "route")
    return (
      <Button size="sm" variant="outline" asChild>
        <Link to={action.to}>{action.label}</Link>
      </Button>
    );
  const external = action.kind === "external";
  return (
    <Button size="sm" variant="outline" asChild>
      <a href={action.to} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {action.label}
        {external && <ExternalLinkIcon aria-hidden />}
      </a>
    </Button>
  );
}

type ItemProps = { item: SetupItem; busy: boolean; onToggle: (key: SetupItemKey, done: boolean) => void };

function SetupRow({ item, busy, onToggle }: ItemProps) {
  if (item.key === "adopt_sites") return null;
  const copy = t.items[item.key];
  const toggle = manualToggle(item);
  const action = item.done ? null : itemAction(item);
  const Icon = item.done ? CircleCheckIcon : CircleDashedIcon;
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Icon
        className={cn("mt-0.5 size-5 shrink-0", item.done ? "text-success" : "text-muted-foreground")}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className={cn("text-sm font-medium", item.done && "text-muted-foreground")}>
            <CodeText>{copy.title}</CodeText>
          </h3>
          <span className="text-xs text-muted-foreground">{item.level ? t.levels[item.level] : null}</span>
          {item.done && (
            <span className="text-xs font-medium text-success">
              {t.done}
              {item.source === "manual" && ` · ${t.manual}`}
            </span>
          )}
        </div>
        {!item.done && (
          <p className="text-sm text-pretty text-muted-foreground">
            <CodeText>{copy.body}</CodeText>
          </p>
        )}
        {!item.done && item.key === "secret_saved" && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {t.secretCopyHint} <InlineCode copy>{SECRET_SCP_COMMAND}</InlineCode>
          </p>
        )}
        {(action || toggle) && (
          <div className="flex flex-wrap gap-2 pt-0.5">
            {action && <ActionLink action={action} />}
            {toggle && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggle(item.key, toggle === "tick")}>
                {toggle === "tick" ? tickLabel(item.key) : t.markUndone}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** "Siapkan Panel Termux" checklist at the top of /dev: progress, the applicable items in order, hide button. */
export function OnboardingCard({
  setup,
  busy,
  onToggle,
  onHide,
}: {
  setup: DevSetup;
  busy: boolean;
  onToggle: ItemProps["onToggle"];
  onHide: () => void;
}) {
  const { done, total } = setupProgress(setup);
  return (
    <section
      id={ONBOARDING_ANCHOR}
      aria-labelledby="onboarding-title"
      className="scroll-mt-20 rounded-lg border border-brand-text/20 bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id="onboarding-title" className="text-base font-semibold">
            {t.title}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onHide} disabled={busy}>
          {t.hide}
        </Button>
      </div>
      <div className="px-4 pt-3">
        <p className="text-xs font-medium text-muted-foreground">{t.progress(done, total)}</p>
        <div
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={t.progress(done, total)}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>
      <ol className="divide-y px-4 py-3">
        {visibleItems(setup).map((item) => (
          <SetupRow key={item.key} item={item} busy={busy} onToggle={onToggle} />
        ))}
      </ol>
    </section>
  );
}
