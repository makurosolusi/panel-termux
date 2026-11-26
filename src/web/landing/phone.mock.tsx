import { BatteryChargingIcon, HardDriveIcon, MemoryStickIcon, ThermometerIcon } from "lucide-react";
import { id } from "@/web/i18n/id";

const t = id.landing;

// Illustrative demo values for the mock screen only; not product measurements.
const STATS = [
  { icon: BatteryChargingIcon, label: t.mock.battery, value: "87%", sub: t.mock.charging, bar: 87 },
  { icon: ThermometerIcon, label: t.mock.temp, value: "34°C", sub: t.mock.tempOk, bar: 40 },
  { icon: MemoryStickIcon, label: t.mock.memory, value: "2.1 GB", sub: "/ 4 GB", bar: 52 },
  { icon: HardDriveIcon, label: t.mock.disk, value: "38 GB", sub: "/ 64 GB", bar: 60 },
];
const SERVICES = ["sshd", "postgres", "pm2", "cloudflared"];

/** Stylized phone showing a panel overview (pure HTML/CSS); decorative, described by one aria-label. */
export function PhoneMock() {
  return (
    <figure className="relative md:rotate-[2.5deg]">
      <span
        aria-hidden
        className="absolute -top-5 -left-6 z-10 -rotate-12 rounded-md border-2 border-lp-signal bg-lp-paper px-2.5 py-1 font-lp-mono text-xs font-bold tracking-widest text-lp-signal uppercase shadow-sm"
      >
        {t.hero.stamp}
      </span>
      <div
        role="img"
        aria-label={t.hero.mockLabel}
        className="rounded-[2.6rem] border border-lp-ink/30 bg-lp-ink/90 p-2.5 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.55)]"
      >
        <div aria-hidden className="overflow-hidden rounded-[2.1rem] bg-lp-screen text-[11px] text-white/90">
          <div className="flex items-center justify-between px-5 pt-3 pb-2 font-lp-mono text-[10px] text-white/50">
            <span>03:12</span>
            <span className="h-4 w-16 rounded-full bg-black" />
            <span>87%</span>
          </div>
          <div className="flex items-center gap-2 border-b border-white/10 px-4 pb-3 font-lp-mono">
            <span className="lp-pulse size-1.5 rounded-full bg-lp-led" />
            <span className="text-white/70">{t.mock.host}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-xl bg-white/[0.06] p-2.5">
                <div className="flex items-center gap-1.5 text-white/55">
                  <s.icon className="size-3" />
                  {s.label}
                </div>
                <div className="mt-1 font-lp-mono text-base font-semibold text-white">{s.value}</div>
                <div className="font-lp-mono text-[10px] text-white/45">{s.sub}</div>
                <div className="mt-2 h-1 rounded-full bg-white/10">
                  <div className="h-1 rounded-full bg-lp-signal-bright" style={{ width: `${s.bar}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="px-3">
            <div className="mb-1.5 px-1 font-lp-mono text-[10px] tracking-wider text-white/45 uppercase">
              {t.mock.services}
            </div>
            <ul className="divide-y divide-white/5 rounded-xl bg-white/[0.04]">
              {SERVICES.map((name, i) => (
                <li key={name} className="flex items-center justify-between px-3 py-2 font-lp-mono">
                  <span>{name}</span>
                  <span className="flex items-center gap-1.5 text-lp-led">
                    <span
                      className="lp-pulse size-1.5 rounded-full bg-lp-led"
                      style={{ animationDelay: `${i * 300}ms` }}
                    />
                    {t.mock.running}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="m-3 rounded-xl bg-black/50 p-3 font-lp-mono text-[10px] leading-relaxed">
            <div className="text-white/50">$ {t.mock.deploy}</div>
            <div className="text-white/70">{t.mock.upload}</div>
            <div className="text-lp-led">
              ✓ {t.mock.deployOk}
              <span className="lp-blink ml-1 inline-block h-3 w-1.5 translate-y-0.5 bg-lp-led" />
            </div>
          </div>
          <div className="mx-auto mt-1 mb-2 h-1 w-24 rounded-full bg-white/25" />
        </div>
      </div>
      <figcaption className="mt-4 text-center font-lp-mono text-[11px] text-lp-dim">{t.hero.mockCaption}</figcaption>
    </figure>
  );
}
