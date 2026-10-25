import { appendFileSync } from "node:fs";

const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || "");
const token = String(process.env.CLOUDFLARE_API_TOKEN || "");
if (!/^[a-f0-9]{32}$/i.test(account) || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
const base = "https://api.cloudflare.com/client/v4";

async function api(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) {
    const detail = (payload.errors || []).map((e) => e.message || e.code).join("; ") || "unknown Cloudflare API error";
    throw new Error(`Cloudflare API ${path} failed (HTTP ${response.status}): ${detail}`);
  }
  return payload.result;
}
function list(result, keys = []) {
  if (Array.isArray(result)) return result;
  for (const key of keys) if (Array.isArray(result?.[key])) return result[key];
  return [];
}
async function ensureNamed({ path, listKeys, name, matchKey, createBody, idKeys = [] }) {
  const result = await api(path);
  const existing = list(result, listKeys).find((item) => item[matchKey] === name);
  if (existing) {
    const id = idKeys.map((key) => existing[key]).find(Boolean);
    return { id: id || "", created: false };
  }
  const created = await api(path, { method: "POST", body: JSON.stringify(createBody) });
  const id = idKeys.map((key) => created?.[key]).find(Boolean) || "";
  return { id, created: true };
}

const buckets = list(await api(`/accounts/${account}/r2/buckets`), ["buckets"]);
if (!buckets.some((bucket) => bucket.name === "hendy-app-store-releases")) {
  await api(`/accounts/${account}/r2/buckets`, { method: "POST", body: JSON.stringify({ name: "hendy-app-store-releases" }) });
  console.log("Created R2 bucket hendy-app-store-releases");
}

const pages = list(await api(`/accounts/${account}/pages/projects`), ["projects"]);
if (!pages.some((project) => project.name === "hendy-app-store")) {
  await api(`/accounts/${account}/pages/projects`, { method: "POST", body: JSON.stringify({ name: "hendy-app-store", production_branch: "main" }) });
  console.log("Created Cloudflare Pages project hendy-app-store");
}

const databases = list(await api(`/accounts/${account}/d1/database`), ["databases"]);
let db = databases.find((item) => item.name === "hendy-app-store-db");
if (!db) {
  db = await api(`/accounts/${account}/d1/database`, { method: "POST", body: JSON.stringify({ name: "hendy-app-store-db" }) });
  console.log("Created D1 database hendy-app-store-db");
}
const d1Id = db.uuid || db.database_id || db.id;
if (!/^[a-f0-9-]{36}$/i.test(String(d1Id || ""))) throw new Error("Cloudflare D1 API did not return a valid database UUID.");

const kvNamespaces = list(await api(`/accounts/${account}/storage/kv/namespaces`), ["namespaces"]);
let kv = kvNamespaces.find((item) => item.title === "hendy-app-store-config");
if (!kv) {
  kv = await api(`/accounts/${account}/storage/kv/namespaces`, { method: "POST", body: JSON.stringify({ title: "hendy-app-store-config" }) });
  console.log("Created KV namespace hendy-app-store-config");
}
const kvId = kv.id || kv.namespace_id;
if (!/^[a-f0-9]{32}$/i.test(String(kvId || ""))) throw new Error("Cloudflare KV API did not return a 32-character namespace ID.");

const queues = list(await api(`/accounts/${account}/queues`), ["queues"]);
for (const queueName of ["hendy-app-store-builds", "hendy-app-store-builds-dlq"]) {
  if (!queues.some((queue) => (queue.queue_name || queue.name) === queueName)) {
    await api(`/accounts/${account}/queues`, { method: "POST", body: JSON.stringify({ queue_name: queueName }) });
    console.log("Created Cloudflare Queue " + queueName);
  }
}
let subdomain = "";
try { const result = await api(`/accounts/${account}/workers/subdomain`); subdomain = String(result.subdomain || ""); } catch { /* account may not have a workers.dev name yet */ }
if (!subdomain) {
  const result = await api(`/accounts/${account}/workers/subdomain`, { method: "PUT", body: JSON.stringify({ subdomain: "hendyappstore" }) });
  subdomain = String(result.subdomain || "hendyappstore");
}
if (!/^[a-z0-9-]+$/i.test(subdomain)) throw new Error("Cloudflare returned an invalid workers.dev subdomain.");

const values = {
  d1_id: d1Id,
  kv_id: kvId,
  workers_subdomain: subdomain,
  api_base: `https://hendy-app-store-api.${subdomain}.workers.dev`,
  edge_base: `https://hendy-app-store-edge.${subdomain}.workers.dev`,
  alerts_base: `https://hendy-app-store-alerts.${subdomain}.workers.dev`,
  pages_base: "https://hendy-app-store.pages.dev"
};
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
console.log(JSON.stringify({ resources: ["R2:hendy-app-store-releases", "Pages:hendy-app-store", "D1:hendy-app-store-db", "KV:hendy-app-store-config", "Queue:hendy-app-store-builds", "Queue:hendy-app-store-builds-dlq"], workerUrls: { api: values.api_base, edge: values.edge_base, alerts: values.alerts_base }, d1Id, kvId, workersSubdomain: subdomain }, null, 2));
