import { Outlet } from "react-router";
import { PageHeader } from "@/web/components/page-header";
import { Toaster } from "@/web/components/ui/sonner";
import { id } from "@/web/i18n/id";
import { type SectionTab, SectionTabs } from "@/web/shared/section.tabs";

const SECTIONS: readonly SectionTab[] = [
  { to: "/dev", label: id.dev.sections.health, end: true },
  { to: "/dev/users", label: id.dev.sections.users },
  { to: "/dev/invites", label: id.dev.sections.invites },
  { to: "/dev/audit", label: id.dev.sections.audit },
  { to: "/dev/logs", label: id.dev.sections.logs },
  { to: "/dev/settings", label: id.dev.sections.settings },
];

/** /dev shell: title, section tabs (horizontally scrollable on phones) and the toast outlet. */
export function DevLayout() {
  return (
    <>
      <PageHeader title={id.dev.title} subtitle={id.dev.subtitle} />
      <SectionTabs label={id.dev.sections.label} tabs={SECTIONS} />
      <Outlet />
      <Toaster position="top-center" richColors />
    </>
  );
}
