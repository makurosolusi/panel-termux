// test-only: already carries the current block (prefix of the Termux phone)
module.exports = { apps: [{ name: "hand", script: "/bin/sh" }] };

// >>> panel-termux:apps v2 (managed by Panel Termux; the panel replaces this block as a whole, do not edit it)
// Adds the sites created by the panel from apps.json to the apps list above. Entries whose binary does not exist yet are skipped,
// because one missing script makes pm2-runtime stop every app. When there is no hand-written app, the pm2-guard
// keeper is added so pm2-runtime does not exit. This block never breaks the file.
;{
  try {
    const fs = require("fs");
    const path = require("path");
    const cfg = module.exports;
    const list = Array.isArray(cfg) ? cfg : cfg && Array.isArray(cfg.apps) ? cfg.apps : null;
    if (list) {
      let panel = [];
      try {
        const raw = require("./apps.json");
        panel = Array.isArray(raw)
          ? raw.filter((a) => a && typeof a.name === "string" && typeof a.script === "string" && a.script !== "" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script)))
          : [];
      } catch (e) {
        console.error("[ecosystem] apps.json dilewati: " + e.message);
      }
      const names = new Set(list.map((a) => a && a.name));
      const handWritten = list.length > 0;
      for (const a of panel) if (!names.has(a.name)) list.push(a);
      if (!handWritten && !names.has("pm2-guard"))
        list.push({ name: "pm2-guard", script: "/data/data/com.termux/files/usr/bin/sleep", args: "infinity", interpreter: "none", autorestart: true });
    }
    globalThis.__panelTermuxApps = { v: 2, listed: list !== null };
  } catch (e) {
    console.error("[ecosystem] blok panel dilewati: " + e.message);
  }
}
// <<< panel-termux:apps
