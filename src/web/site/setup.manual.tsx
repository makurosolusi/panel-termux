import type { Integration } from "@/shared/site.types";
import { CodeText } from "@/web/components/code-text";
import { CopyButton } from "@/web/components/copy-button";
import { InlineCode } from "@/web/components/inline-code";
import { tSite } from "@/web/i18n/en.site";
import { editCommand, manualOpen, snippetNeeded } from "./site.adopt";

const t = tSite.setup.manual;
/** Termux's runit service dir for pm2 (fixed by the Termux layout, `$PREFIX` expands in the user's shell). */
const PM2_RUN_COMMAND = "nano $PREFIX/var/service/pm2/run";
const PM2_UP_COMMAND = "sv up pm2";
/** First line of a new ecosystem file: the empty app list the panel block appends to. */
const NEW_ECOSYSTEM = "module.exports = { apps: [] };\n";

const stateOf = (i: Integration, key: string) => i.checks?.find((c) => c.key === key)?.state;

/** Code block with a copy button in its corner, above the first line (scrolled lines never slide under it). */
function CodeBlock({ code, copyLabel }: { code: string; copyLabel?: string }) {
  return (
    <div className="relative">
      <pre
        className={`overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed ${copyLabel ? "pt-11" : ""}`}
      >
        {code}
      </pre>
      {copyLabel && (
        <div className="absolute top-2 right-2">
          <CopyButton value={code} label={copyLabel} />
        </div>
      )}
    </div>
  );
}

/**
 * "Manual steps (for technical users)" (PLAN/06 F7): native <details> with the block to paste at the end of the
 * ecosystem, the pm2 run script flag and `sv up pm2`, each only when its check fails. Opens by itself when the panel
 * cannot apply a fix; hidden when nothing needs doing by hand.
 */
export function SetupManual({ integration }: { integration: Integration }) {
  const missing = stateOf(integration, "ecosystem_file") === "error";
  const broken = !missing && stateOf(integration, "ecosystem_loads") === "error";
  const block = snippetNeeded(integration);
  // a missing file needs `module.exports.apps` before the block can add to it (QA fix-04 MAJOR-4)
  const code = missing ? `${NEW_ECOSYSTEM}\n${integration.snippet ?? ""}` : integration.snippet;
  const runScript = stateOf(integration, "pm2_auto_exit") === "warning";
  const pm2Down = stateOf(integration, "pm2_runtime") === "error";
  if (!block && !runScript && !pm2Down) return null;
  return (
    <details open={manualOpen(integration)} className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium pointer-coarse:py-3">{t.title}</summary>
      <div className="mt-3 flex flex-col gap-4">
        {block && (
          <ol className="list-decimal space-y-3 pl-5 marker:text-muted-foreground">
            <li className="space-y-1.5">
              <p>{missing ? t.step1Create : t.step1}</p>
              <InlineCode copy>{editCommand(integration)}</InlineCode>
            </li>
            {broken && (
              <li>
                <CodeText>{t.stepRepair}</CodeText>
              </li>
            )}
            <li className="space-y-1.5">
              <p>{missing ? t.step2Create : t.step2}</p>
              {code && <CodeBlock code={code} copyLabel={t.copyBlock} />}
            </li>
            <li>{t.step3}</li>
            <li>{t.step4}</li>
          </ol>
        )}
        {runScript && (
          <div className="space-y-1.5">
            <p>
              <CodeText>{t.runScript}</CodeText>
            </p>
            <InlineCode copy>{PM2_RUN_COMMAND}</InlineCode>
          </div>
        )}
        {pm2Down && (
          <div className="space-y-1.5">
            <p>{t.pm2Start}</p>
            <InlineCode copy>{PM2_UP_COMMAND}</InlineCode>
          </div>
        )}
      </div>
    </details>
  );
}
