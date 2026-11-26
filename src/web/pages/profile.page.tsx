import { LogOutIcon } from "lucide-react";
import { useSignOut } from "@/web/auth/use-sign-out";
import { KeyValue } from "@/web/components/key-value";
import { PageHeader } from "@/web/components/page-header";
import { RoleBadge } from "@/web/components/role-badge";
import { Section } from "@/web/components/section";
import { Button } from "@/web/components/ui/button";
import { UserAvatar } from "@/web/components/user-avatar";
import { idAccount } from "@/web/i18n/id.account";
import type { Me } from "@/web/session/session.api";
import { useMe } from "@/web/session/use-me";
import { canSelfDelete, ProfileDelete } from "./profile.delete";
import { needsAccess, ProfileNoAccess } from "./profile.no-access";
import { ProfileSessions } from "./profile.sessions";
import { ProfileTheme } from "./profile.theme";

const t = idAccount.profile;

/** /profile: [no-access card for `user`] → account → sessions → theme → [self-delete for `user`] (PLAN/05 §5.6, F8). */
export function ProfilePage() {
  const me = useMe();
  return (
    <>
      <PageHeader title={t.title} />
      <div className="flex flex-col gap-8">
        {needsAccess(me.role) && <ProfileNoAccess email={me.email} />}
        <AccountCard me={me} />
        <ProfileSessions />
        <ProfileTheme />
        {canSelfDelete(me.role) && <ProfileDelete email={me.email} />}
      </div>
    </>
  );
}

/** Join date as "26 November 2026" (local calendar). */
const memberSince = (iso: string): string => new Date(iso).toLocaleDateString("id-ID", { dateStyle: "long" });

function AccountCard({ me }: { me: Me }) {
  const { signOut, pending, error } = useSignOut();
  // GET /api/me sends createdAt; the web `Me` type (session.api.ts) does not declare it yet
  const createdAt = (me as Me & { createdAt?: string }).createdAt;
  return (
    <Section title={t.account}>
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:p-5">
        <UserAvatar me={me} className="size-14 text-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{me.name}</p>
            <p className="truncate text-sm text-muted-foreground">{me.email}</p>
          </div>
          <KeyValue
            items={[
              { label: t.role, value: <RoleBadge role={me.role} /> },
              ...(createdAt
                ? [{ label: t.memberSince, value: <time dateTime={createdAt}>{memberSince(createdAt)}</time> }]
                : []),
            ]}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <Button variant="outline" className="shrink-0" disabled={pending} onClick={() => void signOut()}>
          <LogOutIcon aria-hidden />
          {t.signOut}
        </Button>
      </div>
    </Section>
  );
}
