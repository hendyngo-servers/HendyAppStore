import { mkdir, copyFile, cp, writeFile, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const output = "dist/pages";
const source = "apps/web-user";
await mkdir(output, { recursive: true });
if (existsSync("public")) await cp("public", output, { recursive: true });
await mkdir(output + "/web-user", { recursive: true });
await copyFile(source + "/index.html", output + "/index.html");
await cp(source + "/src", output + "/web-user/src", { recursive: true });
const serviceSource = source + "/dich-vu";
if (!existsSync(serviceSource + "/index.html") || !existsSync(serviceSource + "/services.css") || !existsSync(serviceSource + "/hero.webp")) throw new Error("The HENDY service module is incomplete.");
await cp(serviceSource, output + "/web-user/dich-vu", { recursive: true });
await mkdir(output + "/dich-vu", { recursive: true });
await copyFile(serviceSource + "/index.html", output + "/dich-vu/index.html");
await copyFile(source + "/favicon.svg", output + "/web-user/favicon.svg");
await copyFile(source + "/_headers", output + "/_headers");
await copyFile(source + "/_redirects", output + "/_redirects");
for (const path of ["subpage", "legal-notice", "privacy", "js", "css", "g", "bundles", "images", "webcard"]) {
  if (!existsSync(source + "/" + path)) throw new Error("Pages website asset is missing: " + path);
  await cp(source + "/" + path, output + "/" + path, { recursive: true });
}
await copyFile(source + "/sitemap.xml", output + "/sitemap.xml");

function normalizeOrigin(value, label, fallback = "") {
  const raw = String(value || fallback).trim();
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { throw new Error(label + " must be an absolute HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error(label + " must be a clean HTTPS origin.");
  return url.origin;
}
const apiOrigin = normalizeOrigin(process.env.HENDY_API_BASE_URL, "HENDY_API_BASE_URL");
const edgeOrigin = normalizeOrigin(process.env.HENDY_EDGE_BASE_URL, "HENDY_EDGE_BASE_URL");
const publicBase = normalizeOrigin(process.env.HENDY_PUBLIC_STORE_URL, "HENDY_PUBLIC_STORE_URL", "https://hendy-app-store.pages.dev");
const config = { apiBaseUrl: apiOrigin ? apiOrigin + "/api" : "/api", adminUrl: edgeOrigin ? edgeOrigin + "/admin" : "/admin" };
await writeFile(output + "/config.js", "window.HENDY_CONFIG = Object.freeze(" + JSON.stringify(config) + ");\n");
const routes = ["/", "/subpage/", "/legal-notice/", "/privacy/", "/dich-vu/"];
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...routes.map((route, index) => "  <url><loc>" + publicBase + route + "</loc><changefreq>" + (index === 0 ? "daily" : "monthly") + "</changefreq><priority>" + (index === 0 ? "1.0" : "0.6") + "</priority></url>"),
  "</urlset>",
  ""
].join("\n");
await writeFile(output + "/sitemap.xml", sitemap);

const indexPath = output + "/index.html";
let html = await readFile(indexPath, "utf8");
html = html.replace("https://hendy-app-store.pages.dev/", publicBase + "/");
if (!html.includes('<script src="/config.js"></script>')) {
  const entry = '<script type="module" src="/web-user/src/main.js"></script>';
  if (!html.includes(entry)) throw new Error("Pages index.html is missing the public app entry point.");
  html = html.replace(entry, '<script src="/config.js"></script>\n  ' + entry);
}
await writeFile(indexPath, html);
if (!existsSync(output + "/web-user/src/app.js")) throw new Error("Pages output is missing the public app entry point.");
for (const path of ["subpage/index.html", "legal-notice/index.html", "privacy/index.html", "sitemap.xml", "css/custom.261126163517.css", "js/custom.261126163157.js", "g/fonts.css", "bundles/flag-icon-css/css/flag-icons.min.css"]) {
  if (!existsSync(output + "/" + path)) throw new Error("Pages output is missing required website file: " + path);
}
if (existsSync(output + "/api.php")) throw new Error("The PHP compatibility bridge must not be deployed as a Pages static asset.");
if (!existsSync(output + "/dich-vu/index.html") || !existsSync(output + "/web-user/dich-vu/hero.webp")) throw new Error("Pages output is missing the HENDY service route or hero asset.");
if (!existsSync(output + "/config.js")) throw new Error("Pages runtime config was not generated.");
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "api_base=" + apiOrigin + "\nedge_base=" + edgeOrigin + "\n");
console.log(JSON.stringify({ output, apiConfigured: Boolean(apiOrigin), adminConfigured: Boolean(edgeOrigin), publicBase, phpBridgePublished: false }, null, 2));
