import { describe, expect, test } from "bun:test";
import { LOG_LEVEL_TONE, PROBLEM_TONE, STATUS_KEYS, STATUS_META, statusView } from "@/web/components/status.vocab";
import { tStatus, tStatusHelp } from "@/web/i18n/en.status";

describe("canonical status vocabulary", () => {
  test("every key has a non-empty label, a tone and an icon; none is accent", () => {
    expect(STATUS_KEYS).toHaveLength(28);
    for (const key of STATUS_KEYS) {
      const v = statusView(key);
      expect(v.label.trim()).not.toBe("");
      expect(v.icon).toBeDefined();
      expect(v.tone).not.toBe("accent");
    }
    expect(Object.keys(tStatus).sort()).toEqual([...STATUS_KEYS].sort());
  });

  test("rollback and interruption are warning with help text (A10, B12)", () => {
    expect(statusView("rolled_back")).toMatchObject({ label: "Dikembalikan", tone: "warning" });
    expect(statusView("rolled_back").help).toBe("Perubahan gagal; versi lama dipulihkan.");
    expect(statusView("interrupted")).toMatchObject({ label: "Terputus", tone: "warning" });
    expect(statusView("interrupted").help).toBeTruthy();
    expect(statusView("undone").tone).toBe("warning");
  });

  test("intentional stop is neutral, unintended down is danger with a different label (D2)", () => {
    expect(statusView("stopped")).toMatchObject({ label: "Dihentikan", tone: "neutral" });
    expect(statusView("down")).toMatchObject({ label: "Mati", tone: "danger" });
  });

  test("domain verdict and data-key keys", () => {
    expect(statusView("auth_required")).toMatchObject({ tone: "neutral" });
    expect(statusView("auth_required").help).toBe(tStatusHelp.auth_required ?? "");
    expect(statusView("unstable").tone).toBe("warning");
    expect(statusView("tunnel_down")).toMatchObject({ label: "Tunnel terputus", tone: "danger" });
    expect(statusView("key_mismatch")).toMatchObject({ label: "Kunci tidak cocok", tone: "danger" });
  });

  test("only in-flight keys pulse; processing is info", () => {
    const pulsing = STATUS_KEYS.filter((k) => STATUS_META[k].pulse);
    expect(pulsing.sort()).toEqual(["processing", "restarting", "starting"]);
    expect(statusView("processing")).toMatchObject({ tone: "info", pulse: true, label: "Diproses…" });
    expect(statusView("failed").help).toBeNull();
  });

  test("problem severity and log level tones", () => {
    expect(PROBLEM_TONE).toEqual({ info: "info", warning: "warning", danger: "danger" });
    expect(LOG_LEVEL_TONE).toEqual({ debug: "neutral", info: "neutral", warn: "warning", error: "danger" });
  });
});
