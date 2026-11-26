import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { signInWithGoogle } from "@/web/auth/auth.client";
import { Button } from "@/web/components/ui/button";
import { idAccount } from "@/web/i18n/id.account";
import { LogoMark } from "@/web/layout/brand.logo";
import { useDocumentTitle } from "@/web/layout/document.title";
import { loginErrorMessage } from "./login.error";

const t = idAccount.signIn;

/** /login: branded Google sign-in card (PLAN/05 §5.7, F10). */
export function LoginPage() {
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const message = startError ?? loginErrorMessage(params);
  useDocumentTitle(t.title, { raw: true });

  const start = async () => {
    setPending(true);
    setStartError(null);
    const { error } = await signInWithGoogle().catch((cause: unknown) => ({ error: cause }));
    if (error) {
      console.error("signIn.social failed", error);
      setStartError(t.errors.start);
      setPending(false);
    }
    // success: better-auth navigates the browser to Google, keep the button disabled
  };

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-6 rounded-xl border bg-card p-6 shadow-xs">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-10 text-base" />
          <h1 className="text-xl font-semibold tracking-tight text-balance">{t.title}</h1>
          <p className="font-mono text-xs text-muted-foreground">
            <span className="sr-only">{t.hostLabel}: </span>
            {window.location.host}
          </p>
          <p className="text-sm text-muted-foreground text-pretty">{t.subtitle}</p>
        </div>
        {message && (
          <p role="alert" className="rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-sm">
            {message}
          </p>
        )}
        <Button
          size="lg"
          className="h-11 w-full"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => void start()}
        >
          <GoogleIcon />
          {pending ? t.redirecting : t.google}
        </Button>
      </div>
      <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
        <a href="/" className="inline-flex min-h-11 items-center gap-1.5 hover:text-foreground">
          <ArrowLeftIcon className="size-4" aria-hidden />
          {t.back}
        </a>
        <p>
          {t.own}{" "}
          <a
            href={idAccount.noAccess.ownServerHref}
            className="font-medium text-foreground underline underline-offset-4 relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']"
          >
            {t.ownLink}
          </a>
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1a6.18 6.18 0 0 1 0-12.36c1.76 0 2.94.75 3.62 1.4l2.47-2.38C16.5 3.36 14.47 2.4 12 2.4a9.6 9.6 0 1 0 0 19.2c5.54 0 9.2-3.9 9.2-9.38 0-.63-.07-1.11-.15-1.6z"
      />
    </svg>
  );
}
