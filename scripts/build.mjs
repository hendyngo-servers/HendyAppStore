import { mkdir, cp, copyFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const output = "dist/pages";
await rm("dist", { recursive: true, force: true });
await mkdir(output, { recursive: true });
if (existsSync("public")) await cp("public", output, { recursive: true });
const source = "apps/web-user";
await copyFile(`${source}/index.html`, `${output}/index.html`);
await copyFile(`${source}/_headers`, `${output}/_headers`);
await copyFile(`${source}/_redirects`, `${output}/_redirects`);
await cp(`${source}/src`, `${output}/web-user/src`, { recursive: true });
await copyFile(`${source}/favicon.svg`, `${output}/web-user/favicon.svg`);
// Pages Functions can serve the Admin Studio too; middleware gates every Admin route through Backend Access validation.
await cp("apps/web-admin", `${output}/web-admin`, { recursive: true });
await copyFile("apps/web-admin/automation.bundle.js", `${output}/web-admin/automation.bundle.js`);

function normalizedOrigin(value) {
  const rawValue = String(value || "").trim();
  const raw = rawValue.endsWith("/") ? rawValue.slice(0, -1) : rawValue;
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { throw new Error("HENDY_API_BASE_URL and HENDY_EDGE_BASE_URL must be absolute HTTPS URLs."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("HENDY_API_BASE_URL and HENDY_EDGE_BASE_URL must be clean HTTPS origins.");
  }
  return url.origin;
}
const apiOrigin = normalizedOrigin(process.env.HENDY_API_BASE_URL);
const edgeOrigin = normalizedOrigin(process.env.HENDY_EDGE_BASE_URL);
const config = {
  apiBaseUrl: apiOrigin ? apiOrigin + "/api" : "/api",
  adminUrl: edgeOrigin ? edgeOrigin + "/admin" : "/admin"
};
await writeFile(`${output}/config.js`, `window.HENDY_CONFIG = Object.freeze(${JSON.stringify(config)});\n`);
if (!existsSync(`${output}/web-user/src/app.js`)) throw new Error("Public app entry point was not copied.");
if (!existsSync(`${output}/config.js`)) throw new Error("Runtime API config was not generated.");
console.log(JSON.stringify({
  output,
  apiConfigured: Boolean(apiOrigin),
  adminConfigured: Boolean(edgeOrigin),
  note: "For standalone Pages builds set HENDY_API_BASE_URL and HENDY_EDGE_BASE_URL; the production GitHub workflow injects these after provisioning."
}, null, 2));
