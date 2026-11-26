import { Outlet } from "react-router";
import { Toaster } from "@/web/components/ui/sonner";
import { TooltipProvider } from "@/web/components/ui/tooltip";

/** /panel route wrapper: tooltip provider and the toast outlet (navigation lives in the app shell). */
export function PanelLayout() {
  return (
    <TooltipProvider>
      <Outlet />
      <Toaster position="top-center" richColors />
    </TooltipProvider>
  );
}
