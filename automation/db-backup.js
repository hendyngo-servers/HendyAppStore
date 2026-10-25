/**
 * D1 backup helper intended to run inside an authenticated Worker or CI environment.
 * Uses database export jobs; credentials are provided through environment secrets, never files.
 */
export async function exportD1Database({ accountId, databaseId, apiToken }) {
  if (!/^[a-f0-9]{32}$/i.test(String(accountId || "")) || !/^[a-f0-9-]{36}$/i.test(String(databaseId || "")) || !apiToken) throw new Error("Cloudflare account, D1 database ID, and API token are required.");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`, {
    method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ output_format: "polling" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) throw new Error("D1 export request failed: " + JSON.stringify(payload.errors || []).slice(0, 500));
  return payload.result;
}
