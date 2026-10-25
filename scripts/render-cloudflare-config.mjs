import { readFile, writeFile } from "node:fs/promises";

const d1 = String(process.env.D1_DATABASE_ID || "");
const kv = String(process.env.KV_NAMESPACE_ID || "");
if (!/^[a-f0-9-]{36}$/i.test(d1)) throw new Error("D1_DATABASE_ID must be a Cloudflare D1 database UUID.");
if (!/^[a-f0-9]{32}$/i.test(kv)) throw new Error("KV_NAMESPACE_ID must be a 32-character Cloudflare KV namespace ID.");
const quoteToml = (value) => JSON.stringify(String(value || "").replace(/\r|\n/g, ""));
const apiPath = "workers/backend-api/wrangler.toml";
let api = await readFile(apiPath, "utf8");
api = api.replaceAll("__D1_DATABASE_ID__", d1).replaceAll("__KV_NAMESPACE_ID__", kv);
if (api.includes("__D1_DATABASE_ID__") || api.includes("__KV_NAMESPACE_ID__")) throw new Error("API Wrangler placeholders were not replaced.");
if (process.env.HENDY_API_BASE_URL) api = api.replace(/PUBLIC_API_BASE_URL = ".*"/, "PUBLIC_API_BASE_URL = " + quoteToml(process.env.HENDY_API_BASE_URL));
if (process.env.ALLOWED_ORIGINS) api = api.replace(/ALLOWED_ORIGINS = ".*"/, "ALLOWED_ORIGINS = " + quoteToml(process.env.ALLOWED_ORIGINS));
await writeFile(apiPath, api);

const alertsPath = "workers/alert-notifier/wrangler.toml";
let alerts = await readFile(alertsPath, "utf8");
alerts = alerts.replaceAll("__D1_DATABASE_ID__", d1);
if (alerts.includes("__D1_DATABASE_ID__")) throw new Error("Alert Worker D1 placeholder was not replaced.");
await writeFile(alertsPath, alerts);
console.log("Generated Wrangler runtime configs using provisioned D1/KV IDs.");
