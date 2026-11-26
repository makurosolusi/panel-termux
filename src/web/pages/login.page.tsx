import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { signInWithGoogle } from "@/web/auth/auth.client";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { loginErrorMessage } from "./login.error";

/** /login: Google sign-in card. */
export function LoginPage() {
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const message = startError ?? loginErrorMessage(params.get("error"));
  useEffect(() => {
    document.title = id.login.title;
  }, []);

  const start = async () => {
    setPending(true);
    setStartError(null);
    const { error } = await signInWithGoogle().catch((cause: unknown) => ({ error: cause }));
    if (error) {
      console.error("signIn.social failed", error);
      setStartError(id.login.errors.start);
      setPending(false);
    }
    // success: better-auth navigates the browser to Google, keep the button disabled
  };

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center p-4">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{id.login.title}</CardTitle>
          <CardDescription>{id.login.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {message && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {message}
            </p>
          )}
          <Button size="lg" className="w-full" disabled={pending} onClick={() => void start()}>
            <GoogleIcon />
            {pending ? id.login.redirecting : id.login.google}
          </Button>
        </CardContent>
      </Card>
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
