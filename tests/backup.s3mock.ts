// test-only: minimal path-style S3 server for tests/backup.*.test.ts (PUT/GET/HEAD/DELETE object). No listing:
// the panel never lists the bucket (PLAN/04 K3), so any list request is recorded and answered 501.

/** One stored object. */
export type MockObject = { body: Uint8Array<ArrayBuffer>; lastModified: Date };

/** Per-request failure knobs; each predicate gets the object key. */
export type MockFaults = {
  /** PUT answers 500 InternalError. */
  failPut?: (key: string) => boolean;
  /** PUT answers 403 AccessDenied. */
  denyPut?: (key: string) => boolean;
  /** DELETE answers 403 AccessDenied. */
  denyDelete?: (key: string) => boolean;
  /** PUT stores one byte less than it received (stat size mismatch). */
  truncatePut?: (key: string) => boolean;
  /** The request never gets an answer (timeout tests). */
  hang?: (key: string) => boolean;
};

const s3Error = (code: string, status: number) =>
  new Response(`<Error><Code>${code}</Code><Message>mock ${code}</Message></Error>`, { status });

/** Starts the mock on a random port. */
export function startMockS3(bucket: string) {
  const objects = new Map<string, MockObject>();
  const requests: { method: string; key: string; auth: string; url: string }[] = [];
  let faults: MockFaults = {};

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const [, b = "", ...rest] = url.pathname.split("/");
      const key = decodeURIComponent(rest.join("/"));
      requests.push({ method: req.method, key, auth: req.headers.get("authorization") ?? "", url: req.url });
      if (faults.hang?.(key)) return new Promise<Response>(() => {});
      if (b !== bucket) return s3Error("NoSuchBucket", 404);
      if (key === "") return s3Error("NotImplemented", 501);
      if (req.method === "PUT") {
        if (faults.failPut?.(key)) return s3Error("InternalError", 500);
        if (faults.denyPut?.(key)) return s3Error("AccessDenied", 403);
        let body = new Uint8Array(await req.arrayBuffer());
        if (faults.truncatePut?.(key)) body = body.slice(0, -1);
        objects.set(key, { body, lastModified: new Date() });
        return new Response(null, { headers: { etag: '"mock"' } });
      }
      if (req.method === "DELETE") {
        if (faults.denyDelete?.(key)) return s3Error("AccessDenied", 403);
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      const o = objects.get(key);
      if (!o) return s3Error("NoSuchKey", 404);
      const headers = { "content-length": String(o.body.length), "last-modified": o.lastModified.toUTCString() };
      if (req.method === "HEAD") return new Response(null, { headers: { ...headers, etag: '"mock"' } });
      if (req.method === "GET") return new Response(o.body, { headers });
      return s3Error("MethodNotAllowed", 405);
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    objects,
    requests,
    /** Replaces all fault knobs ({} = healthy). */
    setFaults(f: MockFaults) {
      faults = f;
    },
    stop: () => server.stop(true),
  };
}
