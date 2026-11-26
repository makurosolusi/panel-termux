import { Outlet } from "react-router";
import { Toaster } from "@/web/components/ui/sonner";

/** /dev route wrapper: the toast outlet (navigation lives in the app shell). */
export function DevLayout() {
  return (
    <>
      <Outlet />
      <Toaster position="top-center" richColors />
    </>
  );
}
