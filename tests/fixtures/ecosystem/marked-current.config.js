// test-only: already carries the current block (prefix of the Termux phone)
module.exports = { apps: [{ name: "hand", script: "/bin/sh" }] };

// >>> panel-termux:apps v1 (dikelola Panel Termux; panel mengganti blok ini utuh, jangan diedit)
// Menambahkan situs buatan panel dari apps.json ke daftar apps di atas. Entri yang binary-nya belum ada dilewati,
// karena satu script yang hilang membuat pm2-runtime menghentikan semua aplikasi. Bila tidak ada aplikasi tulisan
// tangan, penjaga pm2-guard ditambahkan agar pm2-runtime tidak keluar. Blok ini tidak pernah menggagalkan file.
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
    globalThis.__panelTermuxApps = { v: 1, listed: list !== null };
  } catch (e) {
    console.error("[ecosystem] blok panel dilewati: " + e.message);
  }
}
// <<< panel-termux:apps
