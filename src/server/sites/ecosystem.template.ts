// The shipped deploy/pm2/ecosystem.config.js, embedded in every build (fake sandbox and the Termux binary alike), so
// the sites_dir_create fix can write a fresh ecosystem on a phone that has none (QA fix-04 MAJOR-4).
// @ts-expect-error TS7016: Bun embeds the shipped template as text (`type: "text"`); tsc has no type for a .js text import.
import ECOSYSTEM_TEMPLATE from "../../../deploy/pm2/ecosystem.config.js" with { type: "text" };

/** The shipped ecosystem with its `SITES`/`PREFIX` constants pointed at `sitesDir` and the Termux `prefix`. */
export const ecosystemFromTemplate = (sitesDir: string, prefix: string): string =>
  (ECOSYSTEM_TEMPLATE as string)
    .replace(/^const SITES = .*$/m, `const SITES = ${JSON.stringify(sitesDir)};`)
    .replace(/^const PREFIX = .*$/m, `const PREFIX = ${JSON.stringify(prefix)};`);
