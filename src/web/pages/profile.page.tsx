import { LogOutIcon } from "lucide-react";
import { useSignOut } from "@/web/auth/use-sign-out";
import { PageHeader } from "@/web/components/page-header";
import { RoleBadge } from "@/web/components/role-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { UserAvatar } from "@/web/components/user-avatar";
import { id } from "@/web/i18n/id";
import { useMe } from "@/web/session/use-me";

/** /profile: identity of the signed-in account and sign-out. */
export function ProfilePage() {
  const me = useMe();
  const { signOut, pending, error } = useSignOut();
  return (
    <>
      <PageHeader title={id.profile.title} />
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <UserAvatar me={me} className="size-20 text-xl" />
          <div className="min-w-0 max-w-full">
            <p className="truncate text-lg font-medium">{me.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              <span className="sr-only">{id.profile.email}: </span>
              {me.email}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{id.profile.role}</span>
            <RoleBadge role={me.role} />
          </div>
          <Button variant="outline" className="w-full" disabled={pending} onClick={() => void signOut()}>
            <LogOutIcon />
            {id.menu.signOut}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
