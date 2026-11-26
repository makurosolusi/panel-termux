import { LEGACY_TONE } from "@/web/components/status.tone";
import { StatusBadge as BaseStatusBadge } from "@/web/components/status-badge";
import type { Tone } from "./panel.status";

/** Panel-tone adapter over the shared StatusBadge; kept until pages pass semantic tones directly. */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return <BaseStatusBadge tone={LEGACY_TONE[tone]} label={label} />;
}
