// ~/sites/apps.json: the panel-owned list of pm2 app objects spread into ecosystem.config.js.

/** pm2 app object as written by the panel. */
export type Pm2AppEntry = {
  name: string;
  cwd: string;
  script: string;
  args?: string[];
  interpreter: "none";
  env: { PORT: string };
};

/** Parses apps.json (null/absent = empty list); throws when it is not a JSON array of objects with a name. */
export function parseApps(text: string | null): Record<string, unknown>[] {
  if (text === null || text.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`apps.json is not valid JSON (${(e as Error).name})`, { cause: e });
  }
  if (!Array.isArray(data) || !data.every((a) => typeof a === "object" && a !== null && typeof a.name === "string")) {
    throw new Error("apps.json must be an array of pm2 app objects with a name");
  }
  return data;
}

/** pm2 names in apps.json. */
export const appNames = (text: string | null): string[] => parseApps(text).map((a) => a.name as string);

/** apps.json text with `entry` added; throws if an app with that name exists. */
export function addApp(text: string | null, entry: Pm2AppEntry): string {
  const apps = parseApps(text);
  if (apps.some((a) => a.name === entry.name)) throw new Error(`apps.json already has an app named ${entry.name}`);
  return `${JSON.stringify([...apps, entry], null, 2)}\n`;
}

/** apps.json text without app `name` (unchanged list if absent). */
export const removeApp = (text: string | null, name: string): string =>
  `${JSON.stringify(
    parseApps(text).filter((a) => a.name !== name),
    null,
    2,
  )}\n`;
