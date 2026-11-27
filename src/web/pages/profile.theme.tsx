import { cn } from "cn";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Section } from "@/web/components/section";
import { tAccount } from "@/web/i18n/en.account";
import { THEME_PREFERENCES, type ThemePreference } from "@/web/theme/theme.preference";
import { setThemePreference, useTheme } from "@/web/theme/theme.store";

const t = tAccount.theme;
const ICON: Record<ThemePreference, typeof SunIcon> = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/** "Tema" card: system/light/dark segmented control on the shell theme store. */
export function ProfileTheme() {
  const { preference } = useTheme();
  return (
    <Section title={t.title} description={t.description}>
      <fieldset className="grid max-w-md grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        <legend className="sr-only">{t.title}</legend>
        {THEME_PREFERENCES.map((value) => {
          const Icon = ICON[value];
          return (
            <button
              key={value}
              type="button"
              aria-pressed={preference === value}
              onClick={() => setThemePreference(value)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11",
                preference === value && "bg-background font-medium text-foreground shadow-xs",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t[value]}
            </button>
          );
        })}
      </fieldset>
    </Section>
  );
}
