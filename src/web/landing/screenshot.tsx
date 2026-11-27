import { tLanding } from "@/web/i18n/en.landing";
import { imgLoading, type Shot } from "./landing.shots";

const t = tLanding.shots;

/** Light + dark variant of a screenshot, swapped by the `dark` variant (follows `data-theme`). */
export function Screenshot({ shot, priority = false }: { shot: Shot; priority?: boolean }) {
  const alt = t.items[shot.key].alt;
  const common = { width: shot.width, height: shot.height, decoding: "async" as const };
  return (
    <>
      <img
        alt={alt}
        {...common}
        {...imgLoading(priority, "light")}
        src={shot.light}
        className="block h-auto w-full dark:hidden"
      />
      <img
        alt={alt}
        {...common}
        {...imgLoading(priority, "dark")}
        src={shot.dark}
        className="hidden h-auto w-full dark:block"
      />
    </>
  );
}
