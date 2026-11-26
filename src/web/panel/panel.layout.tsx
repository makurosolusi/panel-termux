import { Outlet } from "react-router";
import { PageHeader } from "@/web/components/page-header";
import { Toaster } from "@/web/components/ui/sonner";
import { TooltipProvider } from "@/web/components/ui/tooltip";
import { id } from "@/web/i18n/id";
import { type SectionTab, SectionTabs } from "@/web/shared/section.tabs";

const t = id.panel.sections;
const SECTIONS: readonly SectionTab[] = [
  { to: "/panel", label: t.overview, end: true },
  { to: "/panel/sites", label: id.site.section },
  { to: "/panel/services", label: t.services },
  { to: "/panel/apps", label: t.apps },
  { to: "/panel/domains", label: t.domains },
  { to: "/panel/databases", label: t.databases },
  { to: "/panel/backups", label: id.backup.section },
];

/** /panel shell: title, section tabs, tooltip provider and the toast outlet. */
export function PanelLayout() {
  return (
    <TooltipProvider>
      <PageHeader title={id.panel.title} subtitle={id.panel.subtitle} />
      <SectionTabs label={t.label} tabs={SECTIONS} />
      <Outlet />
      <Toaster position="top-center" richColors />
    </TooltipProvider>
  );
}
