// Everything that reads a dictionary is reachable only through this module, which the bootstrap (main.tsx) imports
// after the locale overlay is registered (PLAN/08 §4.3, DECISIONS E5).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { tApp } from "@/web/i18n/en.app";
import { router } from "@/web/router";
import { toast } from "@/web/shared/toast.lazy";

/** Mounts the SPA; `packFailed` = the Indonesian pack did not load and the page runs in English. */
export function mount({ packFailed }: { packFailed: boolean }): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("app.mount: #root element missing in index.html");
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  if (packFailed) toast.warning(tApp.languagePackFailed);
}
