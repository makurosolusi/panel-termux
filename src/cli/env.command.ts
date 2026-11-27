// `panel env [--full]` (PLAN/07 K18, §6.2): prints the `.env` template to stdout, notes to stderr. It never reads a
// `.env` or process.env (stat/fstat only) and imports only env.schema, env.codec, cli.locale, node:fs and node:os
// (lab L4/L5). The template comments follow the CLI locale.
import { fstatSync, type Stats, statSync } from "node:fs";
import { homedir } from "node:os";
import { renderEnvTemplate } from "../shared/env.schema";
import { activeCliLocale, tr } from "./cli.locale";
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
      tr(
        "panel env does not append to a .env that has values: the empty keys at the end would override the old values.",
        "panel env tidak menambah ke .env yang berisi: kunci kosong di akhir akan menimpa nilai lama.",
      ),
      `${tr("use", "pakai")}: ${NEW_FILE_HINT}`,
    );
    return 1;
  }
  out.line(renderEnvTemplate({ full: args.values.full === true, locale: activeCliLocale().locale }).slice(0, -1));
  if (target) {
    out.note(
      tr(
        "⚠️ The shell emptied this .env before the panel ran; its old content is gone.",
        "⚠️ .env ini sudah dikosongkan oleh shell sebelum panel berjalan; isi lamanya hilang.",
      ),
    );
    out.note(
      tr(
        `→ restore it from a backup (secrets.tar.gz); next time use: ${NEW_FILE_HINT}`,
        `→ pulihkan dari cadangan (secrets.tar.gz), lain kali pakai: ${NEW_FILE_HINT}`,
      ),
    );
    return 0;
  }
  for (const e of existing) {
    out.note(
      tr(
        `ℹ️ ${e.label} already exists. "panel env > .env" would overwrite it.`,
        `ℹ️ ${e.label} sudah ada. "panel env > .env" akan menimpanya.`,
      ),
    );
    out.note(
      tr(
        `→ use: ${NEW_FILE_HINT}, or turn on set -o noclobber (the shell refuses to overwrite; >| forces it).`,
        `→ pakai: ${NEW_FILE_HINT}, atau aktifkan set -o noclobber (shell menolak menimpa; >| memaksa).`,
      ),
    );
  }
  return 0;
};
