import { cn } from "cn";
import { useState } from "react";
import { LANGUAGE_NAMES, LOCALES, type Locale, parseLocale } from "@/shared/locale";
import type { MePatch } from "@/shared/me.types";
import { Section } from "@/web/components/section";
import { tAccount } from "@/web/i18n/en.account";
import { readStoredLocale, writeStoredLocale } from "@/web/i18n/locale.detect";
import { browserStorage } from "@/web/session/locale.sync";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch } from "@/web/shared/api.client";
import { toast } from "@/web/shared/toast.lazy";

const t = tAccount.language;

/** Choices of the card in display order; `null` = follow the device language. */
export const LANGUAGE_CHOICES: readonly (Locale | null)[] = [...LOCALES, null];

/** Button text: language names stay in their own language (PLAN/08 §3.2); only the device option is translated. */
export const languageChoiceLabel = (choice: Locale | null): string => (choice ? LANGUAGE_NAMES[choice] : t.device);

/**
 * Choice the page actually runs on: the account language, else the browser's stored choice (`?lang=` switcher or an
 * earlier pick, which boot detection honours too), else the device language (`null`).
 */
export function effectiveLanguageChoice(accountLocale: Locale | null, stored: string | null): Locale | null {
  return accountLocale ?? parseLocale(stored);
}

/** Saves the choice on the account, caches it for the next boot and reloads; false (with a toast) when the save failed. */
export async function saveLanguage(
  choice: Locale | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = browserStorage(),
  reload: () => void = () => window.location.reload(),
): Promise<boolean> {
  try {
    await apiFetch<void>("PATCH", "/api/me", { locale: choice } satisfies MePatch);
  } catch (err) {
    toast.error(apiErrorMessage(err), { duration: ERROR_TOAST_MS });
    return false;
  }
  writeStoredLocale(storage, choice);
  reload(); // the only reload of the language feature: dictionaries are applied at boot (DECISIONS E2)
  return true;
}

/** "Language" card: English / Bahasa Indonesia / device language, stored on the account (`PATCH /api/me`). */
export function ProfileLanguage({ locale: accountLocale }: { locale: Locale | null }) {
  const [pending, setPending] = useState<Locale | null | undefined>(undefined);
  const locale = effectiveLanguageChoice(accountLocale, readStoredLocale(browserStorage()));
  const choose = async (choice: Locale | null) => {
    if (choice === locale || pending !== undefined) return;
    setPending(choice);
    if (!(await saveLanguage(choice))) setPending(undefined);
  };
  return (
    <Section title={t.title} description={t.description}>
      <fieldset className="grid max-w-md grid-cols-3 gap-1 rounded-lg bg-muted p-1" aria-busy={pending !== undefined}>
        <legend className="sr-only">{t.title}</legend>
        {LANGUAGE_CHOICES.map((choice) => (
          <button
            key={choice ?? "device"}
            type="button"
            lang={choice ?? undefined}
            aria-pressed={locale === choice}
            disabled={pending !== undefined}
            onClick={() => void choose(choice)}
            className={cn(
              "flex min-h-9 items-center justify-center rounded-md px-2 py-1 text-center text-sm leading-tight text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 pointer-coarse:min-h-11",
              locale === choice && "bg-background font-medium text-foreground shadow-xs",
            )}
          >
            {languageChoiceLabel(choice)}
          </button>
        ))}
      </fieldset>
    </Section>
  );
}
