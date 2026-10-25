import { proxyBackend } from "../_lib/backend.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const tail = String(context.params.path || "").replace(/^\/+/, "");
  const upstreamPath = "/api/" + tail;
  // Do not let a caller use this proxy to target arbitrary hosts or paths.
  if (!tail || tail.includes("..") || tail.includes("\\") || /^https?:/i.test(tail)) {
    return new Response(JSON.stringify({ success: false, error: "invalid_api_path" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
  return proxyBackend(context.request, context.env, upstreamPath + url.search);
}
