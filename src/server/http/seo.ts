import { isKnownSpaPath } from "../../shared/roles";

/** Site name shown in previews and as the `<title>` of every non-landing HTML path. */
const SITE_NAME = "Panel Termux";
/** `X-Robots-Tag` / `<meta name="robots">` value of every HTML path except `/`. */
export const NOINDEX = "noindex, nofollow";
/** Size of `src/web/assets/og.png` (og:image:width/height). */
const OG_IMAGE = { width: 1200, height: 630 };

/**
 * Link-preview text of `/`. PLAN/05 §3.6: must equal `idLanding.meta` once the landing owner (W6) adds it;
 * until then it mirrors the `<title>`/description of src/web/index.html.
 */
export const OG_TEXT: { title: string; description: string; imageAlt: string } = {
  title: "Panel Termux — HP Android jadi server",
  description:
    "Panel web yang mengubah HP Android dengan Termux jadi server untuk aplikasi Bun single-binary: pantau, deploy, backup, dan domain lewat Cloudflare Tunnel.",
  imageAlt:
    "Logo dan nama Panel Termux, tulisan pantau · deploy · backup · domain, dan tangkapan layar Ringkasan di HP",
};

const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Public origin of `baseUrl` (APP_BASE_URL), without a trailing slash. */
const origin = (baseUrl: string): string => new URL(baseUrl).origin;

/** robots.txt: everything crawlable except the API (Disallow would hide the noindex of private pages). */
export function robotsTxt(baseUrl: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin(baseUrl)}/sitemap.xml\n`;
}

/** sitemap.xml with the single public page `/` (absolute URL on APP_BASE_URL). */
export function sitemapXml(baseUrl: string): string {
  const loc = escapeAttr(`${origin(baseUrl)}/`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${loc}</loc></url>\n</urlset>\n`;
}

/** OG/Twitter/canonical tags of `/`, all URLs absolute on `base`. */
function landingTags(base: string): string {
  const meta = (attr: "property" | "name", key: string, value: string | number) =>
    `<meta ${attr}="${key}" content="${escapeAttr(String(value))}" />`;
  return [
    `<link rel="canonical" href="${escapeAttr(`${base}/`)}" />`,
    `<link rel="apple-touch-icon" href="${escapeAttr(`${base}/apple-touch-icon.png`)}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:title", OG_TEXT.title),
    meta("property", "og:description", OG_TEXT.description),
    meta("property", "og:url", `${base}/`),
    meta("property", "og:image", `${base}/og.png`),
    meta("property", "og:image:width", OG_IMAGE.width),
    meta("property", "og:image:height", OG_IMAGE.height),
    meta("property", "og:image:alt", OG_TEXT.imageAlt),
    meta("property", "og:locale", "id_ID"),
    meta("name", "twitter:card", "summary_large_image"),
  ].join("");
}

/**
 * Rewrites `<head>` of the SPA HTML for `pathname`: `/` gets canonical + OG/Twitter tags; every other path
 * gets `noindex` and the plain site title. Status 404 when !isKnownSpaPath(pathname) (A7/K16). Only meta and
 * link tags are added, so the inline-script CSP hashes of `html` stay valid.
 */
export function pageHead(
  html: string,
  pathname: string,
  baseUrl: string,
): { html: string; status: 200 | 404; robots: string | null } {
  const status = isKnownSpaPath(pathname) ? 200 : 404;
  if (pathname === "/") {
    return { html: html.replace("</head>", `${landingTags(origin(baseUrl))}</head>`), status, robots: null };
  }
  const out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${SITE_NAME}</title>`)
    .replace("</head>", `<meta name="robots" content="${NOINDEX}" /></head>`);
  return { html: out, status, robots: NOINDEX };
}
