// Server entry of the problem copy (PLAN/08 §5): Telegram renders in the panel's `alerts.language`, so it picks the
// copy per call. The web must import problem.copy.en.ts instead (this module pulls the Indonesian copy in).
import type { Locale } from "./locale";
import { problemText, tProblem } from "./problem.copy.en";
import { idProblem } from "./problem.copy.id";

/** Problem lines (`title`, `detail`, `recovered`, `recoveredWhileOffline`) in `locale`; server only. */
export const problemCopy = (locale: Locale) => problemText(locale === "id" ? idProblem : tProblem);
