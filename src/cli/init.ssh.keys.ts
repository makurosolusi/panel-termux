// Public-key parsing for step 3a `ssh` (PLAN/07 K22): `--ssh-key` source lines, authorized_keys ids, fingerprints.
import { createHash } from "node:crypto";
import { CliExit } from "./cli.output";
import { INIT_EXIT } from "./init.types";

/** Key types accepted at the start of a line (K22); a line starting with options (`command=` …) is refused. */
export const KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

/** One public key: `type base64 [comment]`; `id` = `type base64` (duplicate check), `fingerprint` as ssh-keygen -l. */
export type PublicKey = { type: string; id: string; line: string; fingerprint: string };

/** SHA256 fingerprint of a key blob, exactly as `ssh-keygen -l` prints it. */
export const fingerprintOf = (blob: Buffer) =>
  `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;

/** Parses one `type base64 [comment]` line; null when it is not a well-formed public key (blob must name its type). */
export function parseKey(line: string): PublicKey | null {
  const [type = "", b64 = ""] = line.trim().split(/\s+/);
  if (!KEY_TYPES.has(type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const blob = Buffer.from(b64, "base64");
  const len = blob.length >= 4 ? blob.readUInt32BE(0) : -1;
  if (len !== type.length || blob.subarray(4, 4 + len).toString("latin1") !== type) return null;
  return { type, id: `${type} ${b64}`, line: line.trim(), fingerprint: fingerprintOf(blob) };
}

/** Every key of a source text (blank and `#` lines skipped); any other line is an error naming its number, not its text. */
export function parseKeys(text: string, source: string): PublicKey[] {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))
    throw new CliExit(INIT_EXIT.failed, `${source} berisi kunci PRIVAT, bukan kunci publik.`, "pakai file .pub");
  const keys: PublicKey[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const key = parseKey(line);
    if (!key)
      throw new CliExit(
        INIT_EXIT.failed,
        `${source} baris ${i + 1} bukan kunci publik SSH (harus diawali ssh-ed25519, ssh-rsa, ecdsa-sha2-… atau sk-…).`,
        "baris yang diawali opsi seperti command= tidak diterima",
      );
    if (!keys.some((k) => k.id === key.id)) keys.push(key);
  }
  if (keys.length === 0) throw new CliExit(INIT_EXIT.failed, `${source} tidak berisi kunci publik.`);
  return keys;
}

/** `type base64` of every key already in authorized_keys (options before the type are allowed there). */
export function existingKeyIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    const t = line.trim().split(/\s+/);
    const i = t.findIndex((tok) => KEY_TYPES.has(tok));
    if (i >= 0 && t[i + 1]) ids.add(`${t[i]} ${t[i + 1]}`);
  }
  return ids;
}

/** authorized_keys after adding `keys`: old lines kept, a missing final newline added first, one line per key. */
export function appendKeys(existing: string, keys: readonly PublicKey[]): string {
  const head = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return head + keys.map((k) => `${k.line}\n`).join("");
}
