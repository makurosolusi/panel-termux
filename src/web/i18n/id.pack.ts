// Indonesian overlay pack (PLAN/08 §4.1, DECISIONS E5): the only importer of `id.*` dictionaries in the web bundle,
// loaded lazily by the bootstrap when the locale is `id`. Keys are the `msg()` domains of the English dictionaries.
import type { Messages } from "@/shared/i18n";
import type { tAccount } from "./en.account";
import type { tApp } from "./en.app";
import type { tBackup } from "./en.backup";
import type { tCommon } from "./en.common";
import type { tDeploy } from "./en.deploy";
import type { tDev } from "./en.dev";
import type { tDevAudit } from "./en.dev.audit";
import type { tDevHealth } from "./en.dev.health";
import type { tDevLogs } from "./en.dev.logs";
import type { tDevSetup } from "./en.dev.setup";
import type { tDevUsers } from "./en.dev.users";
import type { tHistory } from "./en.history";
import type { tJob } from "./en.job";
import type { tLanding } from "./en.landing";
import type { tOverview } from "./en.overview";
import type { tPanel } from "./en.panel";
import type { tSecurity } from "./en.security";
import type { tServiceStart } from "./en.service-start";
import type { tSession } from "./en.session";
import type { tSettings } from "./en.settings";
import type { tShell } from "./en.shell";
import type { tSite } from "./en.site";
import type { tSiteSetup } from "./en.site.setup";
import type { tSiteDetail } from "./en.site-detail";
import type { tStatus, tStatusHelp } from "./en.status";
import { idAccount } from "./id.account";
import { idApp } from "./id.app";
import { idBackup } from "./id.backup";
import { idCommon } from "./id.common";
import { idDeploy } from "./id.deploy";
import { idDev } from "./id.dev";
import { idDevAudit } from "./id.dev.audit";
import { idDevHealth } from "./id.dev.health";
import { idDevLogs } from "./id.dev.logs";
import { idDevSetup } from "./id.dev.setup";
import { idDevUsers } from "./id.dev.users";
import { idHistory } from "./id.history";
import { idJob } from "./id.job";
import { idLanding } from "./id.landing";
import { idOverview } from "./id.overview";
import { idPanel } from "./id.panel";
import { idSecurity } from "./id.security";
import { idServiceStart } from "./id.service-start";
import { idSession } from "./id.session";
import { idSettings } from "./id.settings";
import { idShell } from "./id.shell";
import { idSite } from "./id.site";
import { idSiteSetup } from "./id.site.setup";
import { idSiteDetail } from "./id.site-detail";
import { idStatus, idStatusHelp } from "./id.status";

/** `msg()` domain → English dictionary type; one entry per domain. */
export type Domains = {
  account: typeof tAccount;
  app: typeof tApp;
  backup: typeof tBackup;
  common: typeof tCommon;
  deploy: typeof tDeploy;
  "dev.audit": typeof tDevAudit;
  "dev.health": typeof tDevHealth;
  "dev.logs": typeof tDevLogs;
  "dev.setup": typeof tDevSetup;
  dev: typeof tDev;
  "dev.users": typeof tDevUsers;
  history: typeof tHistory;
  job: typeof tJob;
  landing: typeof tLanding;
  overview: typeof tOverview;
  panel: typeof tPanel;
  security: typeof tSecurity;
  "service-start": typeof tServiceStart;
  session: typeof tSession;
  settings: typeof tSettings;
  shell: typeof tShell;
  "site-detail": typeof tSiteDetail;
  "site.setup": typeof tSiteSetup;
  site: typeof tSite;
  status: typeof tStatus;
  "status.help": typeof tStatusHelp;
};

/** Overlay for every domain, typed against English (missing domain or key = compile error). */
export type OverlayPack = { [K in keyof Domains]: Messages<Domains[K]> };

/** The Indonesian pack. */
const idPack: OverlayPack = {
  account: idAccount,
  app: idApp,
  backup: idBackup,
  common: idCommon,
  deploy: idDeploy,
  "dev.audit": idDevAudit,
  "dev.health": idDevHealth,
  "dev.logs": idDevLogs,
  "dev.setup": idDevSetup,
  dev: idDev,
  "dev.users": idDevUsers,
  history: idHistory,
  job: idJob,
  landing: idLanding,
  overview: idOverview,
  panel: idPanel,
  security: idSecurity,
  "service-start": idServiceStart,
  session: idSession,
  settings: idSettings,
  shell: idShell,
  "site-detail": idSiteDetail,
  "site.setup": idSiteSetup,
  site: idSite,
  status: idStatus,
  "status.help": idStatusHelp,
};
export default idPack;
