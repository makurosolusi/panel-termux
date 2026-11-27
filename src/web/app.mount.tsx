// Everything that reads a dictionary is reachable only through this module, which the bootstrap (main.tsx) imports
// after the locale overlay is registered (PLAN/08 §4.3, DECISIONS E5).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { tApp } from "@/web/i18n/en.app";
import { tLanding } from "@/web/i18n/en.landing";
import { router } from "@/web/router";
import { followUrlHash } from "@/web/shared/hash.scroll";
import { toast } from "@/web/shared/toast.lazy";

/** Mounts the SPA; `packFailed` = the Indonesian pack did not load and the page runs in English. */
export function mount({ packFailed }: { packFailed: boolean }): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("app.mount: #root element missing in index.html");
  // index.html ships the English description (crawlers do not run JS); match the page language for share sheets/readers
  document.querySelector('meta[name="description"]')?.setAttribute("content", tLanding.meta.description);
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  followUrlHash(router);
  if (packFailed) toast.warning(tApp.languagePackFailed);
}
