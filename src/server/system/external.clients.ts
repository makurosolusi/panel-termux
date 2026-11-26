// Clients of outside services (S3, Telegram, Cloudflare DNS). Termux and tests use the real ones; the panel's own
// fake mode (selectSystem on a non-Termux host) swaps in deterministic offline fakes (D-W9-4, external.fake.ts).
import { S3Client } from "bun";
import type { SiteDnsProvider } from "../cloudflare/dns.types";

/** Connection settings an S3 client is built from (same shape as backup's S3Config). */
export type S3Target = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** The part of Bun's S3Client the backup code uses; a real S3Client fits. */
export type S3Like = {
  write(key: string, data: Blob | Uint8Array<ArrayBuffer>): Promise<number>;
  stat(key: string): Promise<{ size: number }>;
  delete(key: string): Promise<void>;
  file(key: string): Blob;
  presign(key: string, opts: { expiresIn: number; method: "GET" }): string;
};

/** Offline stand-ins for every outside service; present on SystemAdapters only in the panel's fake mode. */
export type OfflineClients = {
  s3(target: S3Target): S3Like;
  telegramFetch: typeof fetch;
  dns: Required<SiteDnsProvider>;
};

/** S3 client for `target`: the offline fake in fake mode, else Bun's S3Client. */
export const s3ClientFor = (offline: OfflineClients | undefined, target: S3Target): S3Like =>
  offline ? offline.s3(target) : new S3Client(target);
