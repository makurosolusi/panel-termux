import { useEffect } from "react";
import { idApp } from "@/web/i18n/id.app";

/** Browser tab title of a shell page: "<page> · Panel Termux". */
export const documentTitle = (pageTitle: string): string => `${pageTitle} · ${idApp.appName}`;

/** Sets the tab title: "<title> · Panel Termux", or `title` as is with `raw` (landing, login). */
export function useDocumentTitle(title: string, { raw = false }: { raw?: boolean } = {}) {
  useEffect(() => {
    document.title = raw ? title : documentTitle(title);
  }, [title, raw]);
}
