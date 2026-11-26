import type { DatabaseInfo } from "@/shared/panel.types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { id } from "@/web/i18n/id";
import { formatBytes } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { panelUrl } from "./panel.api";

const t = id.panel.databases;

/** /panel/databases: PostgreSQL databases with owner and size. */
export function DatabasesPage() {
  const query = useApiQuery<DatabaseInfo[]>(panelUrl("/databases"));
  return (
    <QueryView query={query} codes={id.panel.errorCodes} isEmpty={(d) => d.length === 0}>
      {(dbs) => (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.name}</TableHead>
                <TableHead>{t.owner}</TableHead>
                <TableHead className="text-right">{t.size}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dbs.map((db) => (
                <TableRow key={db.name}>
                  <TableCell className="font-mono">{db.name}</TableCell>
                  <TableCell className="text-muted-foreground">{db.owner}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(db.sizeBytes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </QueryView>
  );
}
