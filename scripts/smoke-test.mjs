const edgeBase = String(process.env.HENDY_EDGE_BASE || "").replace(/\/$/, "");
const apiBase = String(process.env.HENDY_API_BASE_URL || "").replace(/\/$/, "");
const pagesBase = String(process.env.PAGES_BASE_URL || "https://hendy-app-store.pages.dev").replace(/\/$/, "");
if (!edgeBase || !apiBase) throw new Error("Set HENDY_EDGE_BASE and HENDY_API_BASE_URL from the provisioning step.");
async function check(url, label, predicate = (r) => r.ok) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "manual" });
  if (!predicate(response)) throw new Error(`${label} failed: HTTP ${response.status} from ${url}`);
  return response;
}
const apiResponse = await check(apiBase + "/api/health", "Backend API");
const api = await apiResponse.json();
if (api.status !== "healthy") throw new Error("Backend health response was not healthy.");
const edgeResponse = await check(edgeBase + "/healthz", "Edge Router");
const edge = await edgeResponse.json();
if (edge.status !== "healthy") throw new Error("Edge health response was not healthy.");
const releasesResponse = await check(apiBase + "/api/releases", "Public release catalog");
const releases = await releasesResponse.json();
if (!releases.success || !Array.isArray(releases.releases)) throw new Error("Release catalog schema is invalid.");
const pagesResponse = await check(pagesBase + "/", "Cloudflare Pages storefront", (r) => r.ok);
const html = await pagesResponse.text();
if (!html.includes("Hendy Store") || !html.includes("/config.js")) throw new Error("Pages storefront HTML is missing expected metadata.");
const configResponse = await check(pagesBase + "/config.js", "Pages runtime API config");
const config = await configResponse.text();
if (!config.includes(apiBase)) throw new Error("Pages API configuration does not point to the deployed API Worker.");
console.log(JSON.stringify({ success: true, edge: edgeBase, api: apiBase, pages: pagesBase, checks: { edgeHealth: true, apiHealth: true, releaseCatalog: true, pagesHtml: true, pagesApiConfig: true } }, null, 2));
