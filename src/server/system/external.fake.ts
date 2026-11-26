// Deterministic offline stand-ins for S3, Telegram and Cloudflare DNS (D-W9-4): the panel's fake mode never calls
// an outside service. S3 objects are plain files under the sandbox, so a demo backup, download link and restore work.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createFakeDnsProvider } from "../cloudflare/dns.fake";
import type { OfflineClients, S3Like, S3Target } from "./external.clients";

/** Folder (under the fake HOME) that holds the fake S3 buckets. */
export const FAKE_S3_DIR = ".fake-s3";
/** Chat the fake bot "sees" in getUpdates (fictional). */
const FAKE_CHAT = { id: 100200300, type: "private", first_name: "Demo", last_name: "Panel" };
const HTTP_NOT_FOUND = 404;

/** Error shaped like Bun's S3Error (`code`), so describeS3Error reads it the same way. */
class FakeS3Error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** S3 bucket backed by `<root>/<bucket>/<key>`; keys outside the bucket folder are refused. */
export function createFakeS3(root: string) {
  return (target: S3Target): S3Like => {
    const bucketDir = resolve(root, target.bucket);
    const path = (key: string) => {
      const p = resolve(bucketDir, key);
      if (!p.startsWith(bucketDir + sep)) throw new FakeS3Error("InvalidKey", `fake s3: key ${key} leaves the bucket`);
      return p;
    };
    return {
      async write(key, data) {
        const p = path(key);
        mkdirSync(dirname(p), { recursive: true });
        return Bun.write(p, data);
      },
      async stat(key) {
        const f = Bun.file(path(key));
        if (!(await f.exists())) throw new FakeS3Error("NoSuchKey", `fake s3: ${key} does not exist`);
        return { size: f.size };
      },
      async delete(key) {
        rmSync(path(key), { force: true });
      },
      file: (key) => Bun.file(path(key)),
      presign: (key, { expiresIn }) =>
        `${target.endpoint.replace(/\/+$/, "")}/${target.bucket}/${key}?X-Amz-Expires=${expiresIn}&fake=1`,
    };
  };
}

/** Bot API stand-in: sendMessage and getUpdates succeed, any other method is 404. */
export const fakeTelegramFetch = (async (input: Parameters<typeof fetch>[0]) => {
  const method = String(input instanceof Request ? input.url : input)
    .split("/")
    .pop();
  if (method === "sendMessage") return Response.json({ ok: true, result: { message_id: 1 } });
  if (method === "getUpdates")
    return Response.json({ ok: true, result: [{ update_id: 1, message: { message_id: 1, chat: FAKE_CHAT } }] });
  return Response.json({ ok: false, error_code: HTTP_NOT_FOUND, description: "Not Found" }, { status: HTTP_NOT_FOUND });
}) as typeof fetch;

/** Offline clients of one fake HOME. */
export const createOfflineClients = (home: string): OfflineClients => ({
  s3: createFakeS3(join(home, FAKE_S3_DIR)),
  telegramFetch: fakeTelegramFetch,
  dns: createFakeDnsProvider(),
});
