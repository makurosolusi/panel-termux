import { WifiOffIcon } from "lucide-react";
import { useRevalidator } from "react-router";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";

/** Root error boundary: `/api/me` unreachable or failing (distinct from 401, which redirects to login). */
export function SessionError() {
  const revalidator = useRevalidator();
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <WifiOffIcon className="size-6 text-destructive" aria-hidden />
          <CardTitle>{id.session.errorTitle}</CardTitle>
          <CardDescription>{id.session.errorBody}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            disabled={revalidator.state === "loading"}
            onClick={() => void revalidator.revalidate()}
          >
            {id.session.retry}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
