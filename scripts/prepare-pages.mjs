import { mkdir, copyFile, cp, writeFile, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const output = "dist/pages";
const source = "apps/web-user";
await mkdir(output, { recursive: true });
await mkdir(`${output}/web-user`, { recursive: true });
await copyFile(`${source}/index.html`, `${output}/index.html`);
await cp(`${source}/src`, `${output}/web-user/src`, { recursive: true });
await copyFile(`${source}/favicon.svg`, `${output}/web-user/favicon.svg`);
await copyFile(`${source}/_headers`, `${output}/_headers`);
await copyFile(`${source}/_redirects`, `${output}/_redirects`);

function normalizeWorkerOrigin(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS origin.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${label} must be a clean HTTPS origin without paths, credentials, query strings, or fragments.`);
  }
  return url.origin;
}

const apiOrigin = normalizeWorkerOrigin(process.env.HENDY_API_BASE_URL, "HENDY_API_BASE_URL");
const edgeOrigin = normalizeWorkerOrigin(process.env.HENDY_EDGE_BASE_URL, "HENDY_EDGE_BASE_URL");
const config = {
  apiBaseUrl: apiOrigin ? apiOrigin + "/api" : "/api",
  adminUrl: edgeOrigin ? edgeOrigin + "/admin" : "/admin"
};
await writeFile(`${output}/config.js`, `window.HENDY_CONFIG = Object.freeze(${JSON.stringify(config)});\n`);

const indexPath = `${output}/index.html`;
let html = await readFile(indexPath, "utf8");
if (!html.includes('<script src="/config.js"></script>')) {
  const entry = '<script type="module" src="/web-user/src/main.js"></script>';
  if (!html.includes(entry)) throw new Error("Pages index.html is missing the public app entry point.");
  html = html.replace(entry, '<script src="/config.js"></script>\n  ' + entry);
}
await writeFile(indexPath, html);
if (!existsSync(`${output}/web-user/src/app.js`)) throw new Error("Pages output is missing the public app entry point.");
if (!existsSync(`${output}/config.js`)) throw new Error("Pages runtime config was not generated.");
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `api_base=${apiOrigin}\nedge_base=${edgeOrigin}\n`);
}
console.log(JSON.stringify({
  output,
  apiConfigured: Boolean(apiOrigin),
  adminConfigured: Boolean(edgeOrigin)
}, null, 2));
