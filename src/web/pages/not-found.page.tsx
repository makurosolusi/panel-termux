import { CompassIcon } from "lucide-react";
import { Link } from "react-router";
import { homeFor } from "@/shared/roles";
import { EmptyState } from "@/web/components/empty-state";
import { PageHeader } from "@/web/components/page-header";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";
import { useMe } from "@/web/session/use-me";

const t = id.shell.notFound;

/** 404 inside the shell: unknown path for a signed-in user, with a way back to their home. */
export function NotFoundPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title={t.title} />
      <EmptyState
        className="border-solid py-16"
        icon={CompassIcon}
        title={t.title}
        description={t.body}
        action={
          <Button asChild>
            <Link to={homeFor(me.role)}>{t.home}</Link>
          </Button>
        }
      />
    </>
  );
}
