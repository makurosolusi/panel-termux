import { BatteryIcon, HardDriveIcon, InfoIcon, MemoryStickIcon, ThermometerIcon } from "lucide-react";
import type { LoadBaseline, Problem } from "@/shared/monitor.types";
import type { DeviceInfo } from "@/shared/panel.types";
import { StatTile } from "@/web/components/stat-tile";
import { TONE_TEXT } from "@/web/components/status.tone";
import { idOverview } from "@/web/i18n/id.overview";
import { formatBytes, formatDuration, formatMegabytes, formatTemperature, usedPercent } from "@/web/shared/format";
import { batteryView, loadView, temperatureTone } from "./overview.state";

const t = idOverview.device;
const GRID = "grid grid-cols-2 gap-3 lg:grid-cols-4";
/** Tighter phone tiles: the 2×2 block stays ≤ 200 px at 390 px (PLAN/02 §6, QA M7). */
const TILE = "max-md:gap-0.5 max-md:py-2.5";

/** Usage bars: memory warns at 90/97 %, disk at 90/95 % used (= the 10 %/5 % free disk rule). */
const MEMORY_THRESHOLDS = { warn: 90, danger: 97 };
const DISK_THRESHOLDS = { warn: 90, danger: 95 };

/** The four device tiles, then load (neutral, with this phone's usual range) and uptime. `device` null = unreadable. */
export function DeviceTiles({
  device,
  baseline,
  problems,
}: {
  device: DeviceInfo | null;
  baseline: LoadBaseline | null | undefined;
  problems: readonly Problem[];
}) {
  if (device === null) {
    return (
      <div className={GRID}>
        {[t.battery, t.temperature, t.memory, t.disk].map((label) => (
          <StatTile key={label} className={TILE} label={label} value="–" hint={idOverview.unavailable} />
        ))}
      </div>
    );
  }
  const battery = batteryView(device.battery, problems);
  // runtime may send null before W7 tightens the type (never a fake 0 °C)
  const temp = (device.battery?.temperatureC ?? null) as number | null;
  const load = loadView(device.load, baseline);
  return (
    <div className="flex flex-col gap-2">
      <div className={GRID}>
        <StatTile
          className={TILE}
          icon={BatteryIcon}
          label={t.battery}
          value={battery.value}
          hint={battery.hint}
          tone={battery.tone}
        />
        <StatTile
          className={TILE}
          icon={ThermometerIcon}
          label={t.temperature}
          value={temp === null ? t.temperatureNone : formatTemperature(temp)}
          tone={temp === null ? undefined : temperatureTone(problems)}
        />
        <StatTile
          className={TILE}
          icon={MemoryStickIcon}
          label={t.memory}
          value={formatMegabytes(device.memory.availableMb)}
          progress={usedPercent(device.memory.availableMb, device.memory.totalMb)}
          thresholds={MEMORY_THRESHOLDS}
          hint={t.memoryOf(formatMegabytes(device.memory.totalMb))}
        />
        <StatTile
          className={TILE}
          icon={HardDriveIcon}
          label={t.disk}
          value={formatBytes(device.disk.freeBytes)}
          progress={usedPercent(device.disk.freeBytes, device.disk.totalBytes)}
          thresholds={DISK_THRESHOLDS}
          hint={t.diskOf(formatBytes(device.disk.totalBytes))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span className="text-foreground/80">{load.value}</span>
        <span className={load.tone && TONE_TEXT[load.tone]}>· {load.usual}</span>
        <details className="group relative">
          <summary
            className="flex size-6 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent pointer-coarse:size-11 [&::-webkit-details-marker]:hidden"
            aria-label={t.loadInfo}
            title={t.loadInfo}
          >
            <InfoIcon className="size-3.5" aria-hidden />
          </summary>
          <p className="absolute left-0 z-20 mt-1 w-64 max-w-[80vw] rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
            {t.loadHelp}
          </p>
        </details>
        <span>· {t.uptime(formatDuration(device.uptimeSec))}</span>
      </div>
    </div>
  );
}
