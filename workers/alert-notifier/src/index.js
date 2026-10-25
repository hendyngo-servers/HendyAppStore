function decodeHex(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), (pair) => parseInt(pair, 16));
}
async function verifySignature(rawBody, supplied, secret) {
  const signature = decodeHex(String(supplied || "").replace(/^sha256=/i, ""));
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  if (expected.length !== signature.length) return false;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ signature[i];
  return diff === 0;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function notifyDiscord(env, payload) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const content = [
    "**Hendy App Store build update**",
    "Workflow: " + String(payload.workflow || "Matrix Build"),
    "Status: **" + String(payload.conclusion || payload.status || "unknown") + "**",
    "Commit: " + String(payload.head_sha || payload.commitSha || "unknown").slice(0, 12),
    payload.html_url ? String(payload.html_url) : ""
  ].filter(Boolean).join("\n");
  await fetch(env.DISCORD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.slice(0, 1900) }) });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json({ ok: true, service: "hendy-alert-notifier" });
    if (request.method !== "POST" || url.pathname !== "/webhooks/github/build-status") return json({ ok: false, error: "not_found" }, 404);
    const raw = await request.text();
    if (raw.length > 256 * 1024) return json({ ok: false, error: "payload_too_large" }, 413);
    if (!await verifySignature(raw, request.headers.get("x-hendy-signature-256"), env.BUILD_STATUS_WEBHOOK_SECRET)) return json({ ok: false, error: "invalid_signature" }, 401);
    let payload;
    try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
    const workflow = payload.workflow?.name || payload.workflow || "Hendy Matrix Build";
    const run = payload.workflow_run || payload;
    const rawStatus = String(run.conclusion || run.status || "unknown");
    const statusMap = { success: "success", failure: "failed", timed_out: "failed", cancelled: "cancelled", queued: "queued", in_progress: "in_progress", skipped: "skipped" };
    const normalizedStatus = statusMap[rawStatus] || "unknown";
    const id = String(run.id || payload.id || crypto.randomUUID());
    if (env.DB) {
      await env.DB.prepare("INSERT INTO build_history (id, run_id, workflow, platform, status, commit_sha, requested_by, source_ref, created_at, started_at, completed_at, html_url, error_message) VALUES (?, ?, ?, 'matrix', ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, completed_at=excluded.completed_at, html_url=excluded.html_url, error_message=excluded.error_message")
        .bind(id, Number(run.id || 0), workflow, normalizedStatus, String(run.head_sha || ""), String(payload.sender?.login || ""), String(run.head_branch || "main"), new Date().toISOString(), run.run_started_at || null, run.updated_at || new Date().toISOString(), String(run.html_url || "").slice(0, 500), String(payload.error_message || "").slice(0, 1000)).run();
    }
    try { await notifyDiscord(env, { ...payload, workflow, conclusion: rawStatus, head_sha: run.head_sha, html_url: run.html_url }); } catch { /* notifications must not break the callback */ }
    return json({ ok: true, stored: !!env.DB, notified: !!env.DISCORD_WEBHOOK_URL });
  }
};
