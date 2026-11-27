// `panel env [--full]` (PLAN/07 K18, §6.2): prints the `.env` template to stdout, notes to stderr. It never reads a
// `.env` or process.env (stat/fstat only) and imports only env.schema, env.codec, node:fs and node:os (lab L4/L5).
import { fstatSync, type Stats, statSync } from "node:fs";
import { homedir } from "node:os";
import { renderEnvTemplate } from "../shared/env.schema";
import type { Command } from "./cli.main";

const NEW_FILE_HINT = "panel env > .env.new";

/** Prints renderEnvTemplate; refuses (exit 1) when stdout is a non-empty `.env` it would append to (m10). */
export const envCommand: Command = async (args, { out }) => {
  const candidates = [
    { label: "./.env", path: `${process.cwd()}/.env` },
    { label: "~/panel/.env", path: `${homedir()}/panel/.env` },
  ];
  const existing: { label: string; st: Stats }[] = [];
  for (const c of candidates) {
    const st = statSync(c.path, { throwIfNoEntry: false });
    // cwd = ~/panel → one file, one note
    if (st && !existing.some((e) => e.st.dev === st.dev && e.st.ino === st.ino)) existing.push({ label: c.label, st });
  }
  const stdout = fstatSync(1);
  const target = existing.find((e) => e.st.dev === stdout.dev && e.st.ino === stdout.ino);
  if (target && stdout.size > 0) {
    out.fail(
      "panel env tidak menambah ke .env yang berisi: kunci kosong di akhir akan menimpa nilai lama.",
      `pakai: ${NEW_FILE_HINT}`,
    );
    return 1;
  }
  out.line(renderEnvTemplate({ full: args.values.full === true }).slice(0, -1));
  if (target) {
    out.note("⚠️ .env ini sudah dikosongkan oleh shell sebelum panel berjalan; isi lamanya hilang.");
    out.note(`→ pulihkan dari cadangan (secrets.tar.gz), lain kali pakai: ${NEW_FILE_HINT}`);
    return 0;
  }
  for (const e of existing) {
    out.note(`ℹ️ ${e.label} sudah ada. "panel env > .env" akan menimpanya.`);
    out.note(`→ pakai: ${NEW_FILE_HINT}, atau aktifkan set -o noclobber (shell menolak menimpa; >| memaksa).`);
  }
  return 0;
};
