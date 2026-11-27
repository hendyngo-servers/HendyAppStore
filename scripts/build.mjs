import { mkdir, cp, copyFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const output = "dist/pages";
await rm("dist", { recursive: true, force: true });
await mkdir(output, { recursive: true });
if (existsSync("public")) await cp("public", output, { recursive: true });
const source = "apps/web-user";
await copyFile(source + "/index.html", output + "/index.html");
await copyFile(source + "/_headers", output + "/_headers");
await copyFile(source + "/_redirects", output + "/_redirects");
await cp(source + "/src", output + "/web-user/src", { recursive: true });
await copyFile(source + "/favicon.svg", output + "/web-user/favicon.svg");
await copyFile(source + "/manifest.webmanifest", output + "/web-user/manifest.webmanifest");
const serviceSource = source + "/dich-vu";
for (const file of ["index.html", "services.css", "hero.webp"]) {
  if (!existsSync(serviceSource + "/" + file)) throw new Error("HENDY service asset is missing: " + file);
}
await cp(serviceSource, output + "/web-user/dich-vu", { recursive: true });
await mkdir(output + "/dich-vu", { recursive: true });
await copyFile(serviceSource + "/index.html", output + "/dich-vu/index.html");
for (const path of ["subpage", "legal-notice", "privacy", "js", "css", "g", "bundles", "images", "webcard"]) {
  if (!existsSync(source + "/" + path)) throw new Error("Static website asset is missing from the Worker source tree: " + path);
  await cp(source + "/" + path, output + "/" + path, { recursive: true });
}
await copyFile(source + "/sitemap.xml", output + "/sitemap.xml");
await cp("apps/web-admin", output + "/web-admin", { recursive: true });
await copyFile("apps/web-admin/automation.bundle.js", output + "/web-admin/automation.bundle.js");

function normalizedOrigin(value) {
  const rawValue = String(value || "").trim();
  const raw = rawValue.endsWith("/") ? rawValue.slice(0, -1) : rawValue;
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { throw new Error("HENDY_API_BASE_URL and HENDY_EDGE_BASE_URL must be absolute HTTPS URLs."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("HENDY_API_BASE_URL and HENDY_EDGE_BASE_URL must be clean HTTPS origins.");
  return url.origin;
}
const apiOrigin = normalizedOrigin(process.env.HENDY_API_BASE_URL);
const edgeOrigin = normalizedOrigin(process.env.HENDY_EDGE_BASE_URL);
const config = { apiBaseUrl: apiOrigin ? apiOrigin + "/api" : "/api", adminUrl: edgeOrigin ? edgeOrigin + "/admin" : "/admin" };
await writeFile(output + "/config.js", "window.HENDY_CONFIG = Object.freeze(" + JSON.stringify(config) + ");\n");
if (!existsSync(output + "/web-user/src/app.js")) throw new Error("Public app entry point was not copied.");
if (!existsSync(output + "/config.js")) throw new Error("Runtime API config was not generated.");
if (existsSync(output + "/api.php")) throw new Error("The PHP compatibility bridge must never be published to Cloudflare Pages.");
console.log(JSON.stringify({ output, apiConfigured: Boolean(apiOrigin), adminConfigured: Boolean(edgeOrigin), phpBridgePublished: false }, null, 2));
