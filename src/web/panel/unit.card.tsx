import { ScrollTextIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";

/** Card for one service/app: name + badges, a muted meta line, control buttons and a link to its log. */
export function UnitCard({
  name,
  badges,
  meta,
  logTo,
  children,
}: {
  name: string;
  badges: ReactNode;
  meta: string[];
  logTo: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto truncate font-mono font-medium">{name}</span>
          {badges}
        </div>
        {meta.length > 0 && <p className="text-xs text-muted-foreground tabular-nums">{meta.join(" · ")}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {children}
          <Button variant="ghost" size="sm" asChild>
            <Link to={logTo}>
              <ScrollTextIcon aria-hidden />
              {id.panel.log.open}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Responsive grid for unit cards: one column on phones, two from `md`. */
export const UNIT_GRID = "grid gap-3 md:grid-cols-2";
