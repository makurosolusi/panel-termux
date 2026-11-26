import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { Site } from "@/shared/site.types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/web/components/ui/alert-dialog";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
import { Label } from "@/web/components/ui/label";
import { id } from "@/web/i18n/id";
import { jobPath, siteUrl, startJob } from "./site.api";

const t = id.site.remove;

/** Delete button + dialog (keep data / keep database for managed sites); starts the delete job. */
export function SiteDelete({ site }: { site: Site }) {
  const navigate = useNavigate();
  const [keepData, setKeepData] = useState(false);
  const [keepDatabase, setKeepDatabase] = useState(false);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    const query = site.managed ? `?keepData=${keepData}&keepDatabase=${keepDatabase}` : "";
    const jobId = await startJob("DELETE", siteUrl(site.name, query));
    setPending(false);
    if (jobId) navigate(jobPath(jobId));
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={pending} className="self-start">
          <Trash2Icon aria-hidden />
          {t.button}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title(site.name)}</AlertDialogTitle>
          <AlertDialogDescription>{site.managed ? t.body : t.unmanaged}</AlertDialogDescription>
        </AlertDialogHeader>
        {site.managed && (
          <div className="flex flex-col gap-3">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={keepData} onCheckedChange={(c) => setKeepData(c === true)} />
              {t.keepData}
            </Label>
            {site.database && (
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={keepDatabase} onCheckedChange={(c) => setKeepDatabase(c === true)} />
                {t.keepDatabase}
              </Label>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{id.common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void confirm()}>
            {t.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
