import { useEffect } from "react";
import { tApp } from "@/web/i18n/en.app";

/** Browser tab title of a shell page: "<page> · Panel Termux". */
export const documentTitle = (pageTitle: string): string => `${pageTitle} · ${tApp.appName}`;

/** Sets the tab title: "<title> · Panel Termux", or `title` as is with `raw` (landing, login). */
export function useDocumentTitle(title: string, { raw = false }: { raw?: boolean } = {}) {
  useEffect(() => {
    document.title = raw ? title : documentTitle(title);
  }, [title, raw]);
}
