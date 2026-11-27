import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const appRoot = "apps/web-user";
const directories = ["subpage", "legal-notice", "privacy", "js", "css", "g", "bundles", "images", "webcard"];
for (const path of ["index.html", "sitemap.xml", ...directories]) {
  if (!existsSync(path)) throw new Error("Required root website path is missing: " + path);
}
const flagPackage = "node_modules/flag-icons";
for (const path of [flagPackage + "/flags/1x1", flagPackage + "/flags/4x3", flagPackage + "/css/flag-icons.min.css"]) {
  if (!existsSync(path)) throw new Error("flag-icons package asset is missing: " + path + "; run npm install first.");
}
const flagRoot = "bundles/flag-icon-css";
await mkdir(flagRoot + "/flags", { recursive: true });
await mkdir(flagRoot + "/css", { recursive: true });
for (const aspect of ["1x1", "4x3"]) {
  await cp(flagPackage + "/flags/" + aspect, flagRoot + "/flags/" + aspect, { recursive: true, force: true });
}
await copyFile(flagPackage + "/css/flag-icons.min.css", flagRoot + "/css/flag-icons.min.css");

await mkdir(appRoot, { recursive: true });
await copyFile("index.html", appRoot + "/index.html");
for (const directory of directories) await cp(directory, appRoot + "/" + directory, { recursive: true, force: true });

function publicOrigin(input) {
  const raw = String(input || "https://hendy-app-store.pages.dev").trim();
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("HENDY_PUBLIC_STORE_URL must be a clean HTTPS origin.");
  }
  return url.origin;
}
const origin = publicOrigin(process.env.HENDY_PUBLIC_STORE_URL);
let appHtml = await readFile(appRoot + "/index.html", "utf8");
appHtml = appHtml.replace("https://hendy-app-store.pages.dev/", origin + "/");
await writeFile(appRoot + "/index.html", appHtml);
const routes = ["/", "/subpage/", "/legal-notice/", "/privacy/", "/dich-vu/"];
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...routes.map((route, index) => "  <url><loc>" + origin + route + "</loc><changefreq>" + (index === 0 ? "daily" : "monthly") + "</changefreq><priority>" + (index === 0 ? "1.0" : "0.6") + "</priority></url>"),
  "</urlset>",
  ""
].join("\n");
await writeFile(appRoot + "/sitemap.xml", xml);
console.log(JSON.stringify({ appRoot, generatedFlagDirectories: ["1x1", "4x3"], publicOrigin: origin, phpBridgePublished: false }, null, 2));
