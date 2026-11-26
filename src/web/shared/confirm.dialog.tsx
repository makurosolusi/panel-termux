import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
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
import { id } from "@/web/i18n/id";

/** Wraps `trigger` (a single button) so clicking it asks for confirmation before calling `onConfirm`. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{id.common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Trash icon button that asks for confirmation before calling `onConfirm`. */
export function ConfirmDelete({
  label,
  disabled,
  ...rest
}: {
  label: string;
  title: string;
  description: ReactNode;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAction
      {...rest}
      destructive
      confirmLabel={id.dev.common.delete}
      trigger={
        <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={label}>
          <Trash2Icon className="text-destructive" aria-hidden />
        </Button>
      }
    />
  );
}
