import { Trash2Icon } from "lucide-react";
import type { Role } from "@/shared/roles";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Button } from "@/web/components/ui/button";
import { tAccount } from "@/web/i18n/en.account";
import { ACCOUNT_DELETED_HREF } from "@/web/landing/account.deleted";
import { apiFetch } from "@/web/shared/api.client";

const t = tAccount.deleteAccount;

/** Self-delete exists only for the `user` role; the server answers 403 for admins, so the card is not rendered. */
export const canSelfDelete = (role: Role): boolean => role === "user";

/** "Delete my account" card: typed-email confirmation → DELETE /api/me → landing with an "account deleted" notice (PLAN/05 F8 step 5). */
export function ProfileDelete({ email }: { email: string }) {
  const remove = async (typed?: string) => {
    await apiFetch<void>("DELETE", "/api/me", { confirm: typed });
    window.location.assign(ACCOUNT_DELETED_HREF); // session rows are gone with the user; a full load resets the client state
  };
  return (
    <section
      aria-labelledby="delete-account-title"
      className="flex flex-col gap-3 rounded-lg border border-danger/25 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="delete-account-title" className="text-base font-semibold">
          {t.title}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t.body}</p>
      </div>
      <ConfirmAction
        tier="typed"
        typedValue={email}
        title={t.dialogTitle}
        description={t.body}
        confirmLabel={t.button}
        destructive
        codes={t.codes}
        onConfirm={remove}
        trigger={
          <Button variant="outline" className="shrink-0 border-danger/40 text-danger">
            <Trash2Icon aria-hidden />
            {t.button}
          </Button>
        }
      />
    </section>
  );
}
