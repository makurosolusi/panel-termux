import { CompassIcon } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/web/components/empty-state";
import { Button } from "@/web/components/ui/button";
import { tShell } from "@/web/i18n/en.shell";
import { BrandLogo } from "@/web/layout/brand.logo";
import { useDocumentTitle } from "@/web/layout/document.title";
import { LANDING_PATH, LOGIN_PATH } from "@/web/session/session.redirect";

const t = tShell.publicNotFound;

/** Guest 404 (DECISIONS A7, copy PLAN/05 §5.7): compact header with logo + "Sign in", then home/sign-in actions. */
export function PublicNotFoundPage() {
  useDocumentTitle(t.title);
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link to={LANDING_PATH} className="rounded-md">
            <BrandLogo />
          </Link>
          <Button asChild size="sm" variant="outline">
            <Link to={LOGIN_PATH}>{t.signIn}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <h1 className="sr-only">{t.title}</h1>
        <EmptyState
          className="border-solid py-16"
          icon={CompassIcon}
          title={t.title}
          description={t.body}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to={LANDING_PATH}>{t.home}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={LOGIN_PATH}>{t.signIn}</Link>
              </Button>
            </div>
          }
        />
      </main>
    </div>
  );
}
