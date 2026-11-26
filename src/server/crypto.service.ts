import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT = "v1";
// HKDF context: a different `info` yields an independent key, so the auth secret is never used directly.
const HKDF_INFO = "panel-termux/settings/v1";

const deriveKey = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "", HKDF_INFO, KEY_BYTES));

/** Encrypts `plaintext` with a key derived from the data secret; returns `v1.<iv>.<tag>.<ciphertext>` (base64). */
export function encryptSecret(secret: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [FORMAT, iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(".");
}

/** Inverse of encryptSecret. Throws when the blob is malformed, tampered with, or the secret changed. */
export function decryptSecret(secret: string, blob: string): string {
  const [fmt, iv, tag, ct] = blob.split(".");
  if (fmt !== FORMAT || iv === undefined || tag === undefined || ct === undefined) {
    throw new Error(`decryptSecret: unsupported format ${fmt ?? "(empty)"}`);
  }
  try {
    const decipher = createDecipheriv(ALGO, deriveKey(secret), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new Error(`decryptSecret: authentication failed (${(e as Error).message})`, { cause: e });
  }
}
