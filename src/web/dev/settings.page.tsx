import type { DevSettings } from "@/shared/dev.types";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { devUrl } from "./dev.api";
import { SettingField } from "./setting.field";

/** /dev/settings: one form per runtime setting, each saved on its own. */
export function SettingsPage() {
  const query = useApiQuery<DevSettings>(devUrl("/settings"));
  return (
    <QueryView query={query} codes={id.dev.errorCodes} isEmpty={(d) => d.items.length === 0}>
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
