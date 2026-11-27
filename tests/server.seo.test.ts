import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inlineScriptHashes } from "@/server/http/security.headers";
import { NOINDEX, OG_TEXT, pageHead, robotsTxt, sitemapXml } from "@/server/http/seo";
import { servePanel } from "@/server/http/spa.serve";

const BASE = "https://panel.example.com"; // test-only
const HTML = `<html><head><title>Old</title><script>boot()</script></head><body></body></html>`; // test-only

describe("seo.ts (pure)", () => {
  test("robots.txt: allow all, disallow /api/ only, absolute Sitemap line", () => {
    expect(robotsTxt(`${BASE}/`)).toBe(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${BASE}/sitemap.xml\n`);
  });

  test("sitemap.xml: exactly one <loc>, the absolute `/`", () => {
    const xml = sitemapXml(BASE);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])).toEqual([`${BASE}/`]);
  });

  test("`/`: canonical, OG, Twitter, apple-touch-icon with absolute URLs; indexable; 200", () => {
    const r = pageHead(HTML, "/", BASE);
    expect(r.status).toBe(200);
    expect(r.robots).toBeNull();
    for (const tag of [
      `<link rel="canonical" href="${BASE}/" />`,
      `<link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="Panel Termux" />`,
      `<meta property="og:title" content="${OG_TEXT.title}" />`,
      `<meta property="og:url" content="${BASE}/" />`,
      `<meta property="og:image" content="${BASE}/og.png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:locale" content="en_US" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    ]) {
      expect(r.html).toContain(tag);
    }
    expect(r.html).not.toContain("noindex");
    expect(r.html).toContain("<title>Old</title>");
  });

  test("other known path: noindex meta, plain title, 200, no OG", () => {
    const r = pageHead(HTML, "/panel/apps", BASE);
    expect(r).toMatchObject({ status: 200, robots: NOINDEX });
    expect(r.html).toContain(`<meta name="robots" content="${NOINDEX}" />`);
    expect(r.html).toContain("<title>Panel Termux</title>");
    expect(r.html).not.toContain("og:");
  });

  test("unknown path (A7): 404 + noindex", () => {
    for (const p of ["/nope", "/panelx", "/__spa", "/robots"]) {
      expect(pageHead(HTML, p, BASE)).toMatchObject({ status: 404, robots: NOINDEX });
    }
  });

  test("only tags are injected: inline-script CSP hashes are unchanged", () => {
    for (const p of ["/", "/login", "/nope"]) {
      expect(inlineScriptHashes(pageHead(HTML, p, BASE).html)).toEqual(inlineScriptHashes(HTML));
    }
  });

  test("attribute values are escaped", () => {
    expect(pageHead(HTML, "/", 'https://a.example.com/"x').html).not.toContain('"x');
  });
});

describe("servePanel SEO routes (production mode)", () => {
  let server: ReturnType<typeof servePanel>;
  let local = "";
  const get = (path: string, init: RequestInit = {}) =>
    fetch(`${local}${path}`, { redirect: "manual", ...init, headers: { host: "panel.example.com", ...init.headers } });

  beforeAll(() => {
    server = servePanel({ handle: () => new Response("api") }, BASE, 0, false);
    local = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => server.stop(true));

  test("/robots.txt and /sitemap.xml: real routes with their types", async () => {
    const robots = await get("/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toContain("text/plain");
    expect(await robots.text()).toBe(robotsTxt(BASE));
    const sitemap = await get("/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("content-type")).toContain("application/xml");
    expect(await sitemap.text()).toBe(sitemapXml(BASE));
  });

  test("/og.png 1200×630, /apple-touch-icon.png 180×180, /favicon.ico PNG: image/png, cached a day", async () => {
    const size = (b: ArrayBuffer) => {
      const v = new DataView(b);
      return [v.getUint32(16), v.getUint32(20)]; // PNG IHDR width, height
    };
    for (const [path, dims] of [
      ["/og.png", [1200, 630]],
      ["/apple-touch-icon.png", [180, 180]],
      ["/favicon.ico", [180, 180]],
    ] as const) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(size(await res.arrayBuffer())).toEqual([...dims]);
    }
  });

  test("`/`: OG injected, indexable, no ETag/Last-Modified, never 304", async () => {
    const res = await get("/", { headers: { "if-none-match": "*" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("last-modified")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain(`<meta property="og:image" content="${BASE}/og.png" />`);
  });

  test("other pages: X-Robots-Tag + meta noindex; unknown path → 404 (GET and HEAD)", async () => {
    const login = await get("/login");
    expect(login.status).toBe(200);
    expect(login.headers.get("x-robots-tag")).toBe(NOINDEX);
    expect(await login.text()).toContain(`<meta name="robots" content="${NOINDEX}" />`);
    for (const method of ["GET", "HEAD"]) {
      const res = await get("/nope", { method });
      expect(res.status).toBe(404);
      expect(res.headers.get("x-robots-tag")).toBe(NOINDEX);
      expect(res.headers.get("etag")).toBeNull();
    }
  });

  test("CSP of the rewritten page still matches its inline scripts", async () => {
    const res = await get("/");
    const csp = res.headers.get("content-security-policy") ?? "";
    for (const h of inlineScriptHashes(await res.text())) expect(csp).toContain(h);
  });
});
