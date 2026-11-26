import { Avatar, AvatarFallback, AvatarImage } from "@/web/components/ui/avatar";
import type { Me } from "@/web/session/session.api";

/** Google avatar with initials fallback. */
export function UserAvatar({ me, className }: { me: Me; className?: string }) {
  const initials = (me.name || me.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <Avatar className={className}>
      {me.image && <AvatarImage src={me.image} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
