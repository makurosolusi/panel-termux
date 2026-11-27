import { LockKeyholeIcon, RotateCwIcon } from "lucide-react";
import type { Role } from "@/shared/roles";
import { CopyButton } from "@/web/components/copy-button";
import { Button } from "@/web/components/ui/button";
import { tAccount } from "@/web/i18n/en.account";

const t = tAccount.noAccess;

/** Only accounts with the `user` role have no panel access yet and see the next-steps card (PLAN/05 F8 step 3). */
export const needsAccess = (role: Role): boolean => role === "user";

/** "No access yet" card: why, three concrete steps, email to copy, reload, link to install your own. */
export function ProfileNoAccess({ email }: { email: string }) {
  return (
    <section
      aria-labelledby="no-access-title"
      className="flex flex-col gap-4 rounded-lg border border-info/25 bg-info-subtle p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <LockKeyholeIcon className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="no-access-title" className="text-base font-semibold text-balance">
            {t.title}
          </h2>
          <p className="text-sm text-foreground/80 text-pretty">{t.body}</p>
        </div>
      </div>
      <ol className="ml-8 list-decimal flex flex-col gap-1 text-sm">
        {t.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="ml-8 flex min-w-0 flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t.emailLabel}</span>
        <div className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-sm">{email}</span>
          <CopyButton value={email} />
        </div>
      </div>
      <div className="ml-8 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="sm" onClick={() => window.location.reload()}>
          <RotateCwIcon aria-hidden />
          {t.reload}
        </Button>
        <a href={t.ownServerHref} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          {t.ownServer}
        </a>
      </div>
    </section>
  );
}
