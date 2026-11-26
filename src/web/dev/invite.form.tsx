import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { DevInvite } from "@/shared/dev.types";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { id } from "@/web/i18n/id";
import { devErrorMessage, devFetch, devUrl } from "./dev.api";
import { normalizeInviteEmail } from "./invite.email";

const t = id.dev.invites;

/** Add-invite form: validates the email shape locally and shows server errors (e.g. `exists`) inline. */
export function InviteForm({ onAdded }: { onAdded: () => void }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const email = normalizeInviteEmail(raw);
    if (!email) return setError(t.invalidEmail);
    setPending(true);
    setError(null);
    try {
      await devFetch<DevInvite>("POST", devUrl("/invites"), { email });
      toast.success(t.added);
      setRaw("");
      onAdded();
    } catch (err) {
      setError(devErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor="invite-email">{t.emailLabel}</Label>
      <div className="flex gap-2">
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          value={raw}
          placeholder={t.emailPlaceholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-email-error" : undefined}
          onChange={(e) => {
            setRaw(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" disabled={pending || raw.trim() === ""}>
          <UserPlusIcon aria-hidden />
          <span className="sr-only sm:not-sr-only">{t.add}</span>
        </Button>
      </div>
      {error && (
        <p id="invite-email-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
