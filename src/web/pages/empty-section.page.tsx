import { ConstructionIcon } from "lucide-react";
import { PageHeader } from "@/web/components/page-header";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";

/** Placeholder section page (/panel, /dev) until later waves add content. */
export function EmptySectionPage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
          <ConstructionIcon className="size-8" aria-hidden />
          <p>{id.empty}</p>
        </CardContent>
      </Card>
    </>
  );
}
