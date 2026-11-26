import { idLanding } from "@/web/i18n/id.landing";
import { imgLoading, type Shot } from "./landing.shots";

const t = idLanding.shots;
/** Placeholder skeleton: stat tiles and list-row widths (%), fixed so the keys are stable. */
const TILES = ["a", "b", "c", "d"] as const;
const ROW_WIDTHS = [70, 53, 66, 49, 62, 45] as const;

/**
 * Light + dark variant of a screenshot, swapped by the `dark` variant (follows `data-theme`). Shows a labelled
 * placeholder with the same aspect ratio while the image files are missing.
 */
export function Screenshot({ shot, priority = false }: { shot: Shot; priority?: boolean }) {
  const alt = t.items[shot.key].alt;
  if (!shot.light || !shot.dark) return <Placeholder shot={shot} alt={alt} />;
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

/** Skeleton of a panel page in the landing palette, announced as the screenshot it stands in for. */
function Placeholder({ shot, alt }: { shot: Shot; alt: string }) {
  const rows = shot.device === "phone" ? ROW_WIDTHS : ROW_WIDTHS.slice(0, 4);
  return (
    <div
      role="img"
      aria-label={alt}
      style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
      className="flex w-full flex-col gap-3 bg-lp-screen p-[7%] text-white/40"
    >
      <div aria-hidden className="flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded bg-lp-signal-bright font-lp-mono text-[9px] font-bold text-lp-screen">
          &gt;_
        </span>
        <span className="h-2 w-1/3 rounded-full bg-white/15" />
      </div>
      <div aria-hidden className={`grid gap-2 ${shot.device === "phone" ? "grid-cols-2" : "grid-cols-4"}`}>
        {TILES.map((tile) => (
          <span key={tile} className="h-10 rounded-md border border-white/10 bg-white/[0.04]" />
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-2">
        {rows.map((width, i) => (
          <span key={width} className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${i === 1 ? "bg-lp-signal-bright" : "bg-lp-led/70"}`} />
            <span className="h-1.5 rounded-full bg-white/10" style={{ width: `${width}%` }} />
          </span>
        ))}
      </div>
      <span aria-hidden className="mt-auto self-center font-lp-mono text-[10px] tracking-wider uppercase">
        {t.pending}
      </span>
    </div>
  );
}
