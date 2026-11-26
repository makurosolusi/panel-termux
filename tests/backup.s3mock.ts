// test-only: minimal path-style S3 server for tests/backup.*.test.ts (PUT/GET/DELETE object, ListObjectsV2).

/** One stored object. */
export type MockObject = { body: Uint8Array<ArrayBuffer>; lastModified: Date };

const xmlEscape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Starts the mock on a random port; `failPut` makes PUTs of matching keys fail with 500. */
export function startMockS3(bucket: string) {
  const objects = new Map<string, MockObject>();
  const requests: { method: string; key: string; auth: string; url: string }[] = [];
  let failPut: ((key: string) => boolean) | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const [, b = "", ...rest] = url.pathname.split("/");
      const key = decodeURIComponent(rest.join("/"));
      requests.push({ method: req.method, key, auth: req.headers.get("authorization") ?? "", url: req.url });
      if (b !== bucket) return new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 });
      if (req.method === "GET" && key === "") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const contents = keys
          .map((k) => {
            const o = objects.get(k) as MockObject;
            return `<Contents><Key>${xmlEscape(k)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`;
          })
          .join("");
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
          { headers: { "content-type": "application/xml" } },
        );
      }
      if (req.method === "PUT") {
        if (failPut?.(key))
          return new Response("<Error><Code>InternalError</Code><Message>mock failure</Message></Error>", {
            status: 500,
          });
        objects.set(key, { body: new Uint8Array(await req.arrayBuffer()), lastModified: new Date() });
        return new Response(null, { headers: { etag: '"mock"' } });
      }
      const o = objects.get(key);
      if (req.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      if ((req.method === "GET" || req.method === "HEAD") && o) return new Response(o.body);
      return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    objects,
    requests,
    setFailPut(f: ((key: string) => boolean) | null) {
      failPut = f;
    },
    stop: () => server.stop(true),
  };
}
