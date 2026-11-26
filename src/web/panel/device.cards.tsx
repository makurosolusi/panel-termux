import { ActivityIcon, BatteryIcon, ClockIcon, HardDriveIcon, MemoryStickIcon } from "lucide-react";
import type { DeviceInfo } from "@/shared/panel.types";
import { Progress } from "@/web/components/ui/progress";
import { id } from "@/web/i18n/id";
import { formatBytes, formatLoad, formatUptime, usedPercent } from "@/web/shared/format";
import { StatCard } from "@/web/shared/stat.card";

const t = id.panel.device;

/** Battery, memory, disk, load and uptime of the phone. */
export function DeviceCards({ d }: { d: DeviceInfo }) {
  const mem = usedPercent(d.memory.availableMb, d.memory.totalMb);
  const disk = usedPercent(d.disk.freeBytes, d.disk.totalBytes);
  return (
    <>
      <StatCard icon={BatteryIcon} label={t.battery} value={d.battery ? `${d.battery.percent}%` : t.noBattery}>
        {d.battery && `${d.battery.charging ? t.charging : t.notCharging} · ${t.temperature(d.battery.temperatureC)}`}
      </StatCard>
      <StatCard icon={MemoryStickIcon} label={t.memory} value={`${mem}%`}>
        <Progress value={mem} className="my-1" aria-label={t.memory} />
        {t.memoryFree(d.memory.availableMb, d.memory.totalMb)}
      </StatCard>
      <StatCard icon={HardDriveIcon} label={t.disk} value={`${disk}%`}>
        <Progress value={disk} className="my-1" aria-label={t.disk} />
        {t.diskFree(formatBytes(d.disk.freeBytes), formatBytes(d.disk.totalBytes))}
      </StatCard>
      <StatCard icon={ActivityIcon} label={t.load} value={formatLoad(d.load)} />
      <StatCard icon={ClockIcon} label={t.uptime} value={formatUptime(d.uptimeSec)} />
    </>
  );
}
