import { useCallback, useEffect, useState } from "react";
import { useBlocker } from "react-router";
import type { DevSetting, DevSettings } from "@/shared/dev.types";
import { EmptyState } from "@/web/components/empty-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { tSettings } from "@/web/i18n/en.settings";
import { useApiQuery } from "@/web/shared/use-api-query";
import { devUrl } from "./dev.api";
import { SettingsGroup } from "./settings.group";
import { GROUP_ANCHOR, SETTING_GROUPS, type SettingGroup } from "./settings.registry";
import { groupItems } from "./settings.state";

const t = tSettings;
const SETTINGS_URL = devUrl("/settings");

/** Warns before leaving with unsaved cards: in-app navigation (router blocker) and tab close/reload (beforeunload). */
function useLeaveGuard(dirty: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(t.leaveWarning)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/** /dev/settings: six cards (anchors `#cloudflare`, `#backup`, …), each saved atomically with its own test. */
export function SettingsPage() {
  const query = useApiQuery<DevSettings>(SETTINGS_URL);
  // Last PATCH response, valid only for the GET result it was saved on top of (a newer GET wins).
  const [saved, setSaved] = useState<{ on: DevSettings | undefined; items: DevSetting[] } | null>(null);
  const [dirtyGroups, setDirtyGroups] = useState<ReadonlySet<SettingGroup>>(new Set());
  useLeaveGuard(dirtyGroups.size > 0);

  const onDirty = useCallback((g: SettingGroup, dirty: boolean) => {
    setDirtyGroups((prev) => {
      if (prev.has(g) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(g);
      else next.delete(g);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t.title}
        description={t.subtitle}
        meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading }}
      />
      <QueryView
        query={query}
        codes={t.errorCodes}
        empty={<EmptyState title={t.emptyPage} />}
        isEmpty={(d) => d.items.length === 0}
      >
        {(d) => {
          const items = saved && saved.on === d ? saved.items : d.items;
          return (
            <div className="grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
              <nav aria-label={t.toc} className="max-lg:hidden">
                <ul className="sticky top-20 flex flex-col gap-0.5 text-sm">
                  {SETTING_GROUPS.map((g) => (
                    <li key={g}>
                      <a
                        href={`#${GROUP_ANCHOR[g]}`}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {t.groups[g].title}
                        {dirtyGroups.has(g) && (
                          <>
                            <span className="size-1.5 rounded-full bg-info" aria-hidden />
                            <span className="sr-only">{t.dirty}</span>
                          </>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="flex min-w-0 flex-col gap-4">
                {SETTING_GROUPS.map((g) => (
                  <SettingsGroup
                    key={g}
                    group={g}
                    items={groupItems(g, items)}
                    onSaved={(next) => setSaved({ on: d, items: next })}
                    onDirty={onDirty}
                    onReload={query.reload}
                  />
                ))}
              </div>
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
