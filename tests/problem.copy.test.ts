// Problem copy in both languages (PLAN/08 §5): English source, Indonesian variant, per-locale number formatting.
import { describe, expect, test } from "bun:test";
import type { ProblemCode, ProblemParams } from "@/shared/monitor.types";
import { problemCopy } from "@/shared/problem.copy";
import { detail, title } from "@/shared/problem.copy.en";

const params: ProblemParams = {
  downSec: 125,
  restarts: 1500,
  restarts10m: 4,
  status: 502,
  local: 200,
  port: 3001,
  hours: 40,
  name: "blog",
  freePct: 4.5,
  freeBytes: 2 * 1024 ** 3,
  percent: 22,
  temperatureC: 46.5,
  reason: "telegram_forbidden",
  uptimeMin: 4,
};
const CODES = {
  service_down: 1,
  service_crash_loop: 1,
  pm2_unavailable: 1,
  app_errored: 1,
  app_crash_loop: 1,
  domain_unreachable: 1,
  domain_http_error: 1,
  internet_down: 1,
  backup_not_configured: 1,
  backup_failed: 1,
  backup_partial: 1,
  backup_stale: 1,
  backup_item_stale: 1,
  backup_status_error: 1,
  backup_secrets_included: 1,
  key_mismatch: 1,
  access_not_seen: 1,
  disk_low: 1,
  battery_low: 1,
  battery_hot: 1,
  alerts_failing: 1,
  site_job_failed: 1,
  host_rebooted: 1,
  panel_restarted_unexpectedly: 1,
} satisfies Record<ProblemCode, 1>;

describe("problem copy", () => {
  test.each(["en", "id"] as const)("every ProblemCode has a %s title and detail", (locale) => {
    const copy = problemCopy(locale);
    for (const code of Object.keys(CODES) as ProblemCode[]) {
      const p = { code, target: "blog", params };
      expect(copy.title(p).length).toBeGreaterThan(5);
      expect(copy.detail(p).length).toBeGreaterThan(5);
    }
  });

  test("the web copy is the English source (no overlay registered in tests)", () => {
    const p = { code: "service_down" as const, target: "nginx", params };
    expect(title(p)).toBe("Service nginx is down");
    expect(detail(p)).toBe("It should be running. Down for 2 min 5 s.");
    expect(problemCopy("en").title(p)).toBe(title(p));
  });

  test("English wording", () => {
    const en = problemCopy("en");
    expect(en.title({ code: "battery_low", target: "battery", params })).toBe("Battery at 22% and not charging");
    expect(en.detail({ code: "domain_unreachable", target: "x", params })).toBe(
      "The app on the phone answers 200, so the problem is in the tunnel.",
    );
    expect(en.detail({ code: "domain_http_error", target: "x", params: { status: 530 } })).toBe(
      "Cloudflare can't reach the cloudflared tunnel on the phone.",
    );
    expect(en.detail({ code: "alerts_failing", target: "telegram", params: { reason: "telegram_unreachable" } })).toBe(
      "Telegram can't be reached from the phone.",
    );
    expect(
      en.title({ code: "backup_item_stale", target: "database:blog", params: { name: "blog", hours: null } }),
    ).toBe("Backup of blog has never succeeded");
    expect(
      en.title({ code: "backup_item_stale", target: "g", params: { itemKind: "globals", name: "globals", hours: 30 } }),
    ).toBe("Backup of Postgres roles hasn't succeeded for 30 hours");
    expect(en.recovered({ code: "service_down", target: "nginx", params }, 125)).toBe(
      "Service nginx is down · lasted 2 min 5 s",
    );
    expect(en.recovered({ code: "internet_down", target: "internet", params }, 60)).toBe(
      "The phone was offline for 1 min",
    );
    expect(en.recoveredWhileOffline({ code: "pm2_unavailable", target: "pm2", params }, 3600)).toBe(
      "pm2 isn't running · recovered while the panel wasn't running (last seen 1 h ago)",
    );
  });

  test("Indonesian wording", () => {
    const id = problemCopy("id");
    expect(id.title({ code: "battery_low", target: "battery", params })).toBe("Baterai tinggal 22% dan tidak mengisi");
    expect(id.detail({ code: "service_down", target: "x", params })).toBe(
      "Seharusnya berjalan. Mati sejak 2 mnt 5 dtk.",
    );
    expect(
      id.title({ code: "backup_item_stale", target: "g", params: { itemKind: "globals", name: "globals", hours: 30 } }),
    ).toBe("Cadangan role Postgres sudah 30 jam tidak berhasil");
    expect(id.recovered({ code: "internet_down", target: "internet", params }, 60)).toBe(
      "HP sempat tidak terhubung internet selama 1 mnt",
    );
  });

  test("numbers use the separators of the copy's locale", () => {
    const en = problemCopy("en");
    const id = problemCopy("id");
    const disk = { code: "disk_low" as const, target: "disk", params };
    const hot = { code: "battery_hot" as const, target: "battery", params };
    const errored = { code: "app_errored" as const, target: "blog", params };
    expect(en.detail(disk)).toBe("Only 4.5% (2.0 GB) free.");
    expect(id.detail(disk)).toBe("Tinggal 4,5% (2,0 GB) bebas.");
    expect(en.title(hot)).toBe("Battery is hot (46.5 °C)");
    expect(id.title(hot)).toBe("Baterai panas (46,5 °C)");
    expect(en.detail(errored)).toBe("pm2 gave up after 1,500 failed attempts. Check the stderr log.");
    expect(id.detail(errored)).toBe("pm2 berhenti mencoba setelah 1.500× gagal. Lihat log stderr.");
  });
});
