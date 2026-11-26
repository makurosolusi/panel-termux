import type { DevSettings } from "@/shared/dev.types";
import { Card, CardContent } from "@/web/components/ui/card";
import { devUrl } from "./dev.api";
import { QueryView } from "./query.state";
import { SettingField } from "./setting.field";
import { useDevQuery } from "./use-dev-query";

/** /dev/settings: one form per runtime setting, each saved on its own. */
export function SettingsPage() {
  const query = useDevQuery<DevSettings>(devUrl("/settings"));
  return (
    <QueryView query={query} isEmpty={(d) => d.items.length === 0}>
      {(d) => (
        <Card className="py-0">
          <CardContent className="divide-y px-4">
            {d.items.map((s) => (
              <SettingField key={s.key} setting={s} onSaved={query.reload} />
            ))}
          </CardContent>
        </Card>
      )}
    </QueryView>
  );
}
