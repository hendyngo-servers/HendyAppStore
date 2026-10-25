import { proxyBackend } from "../_lib/backend.js";

export async function onRequestGet(context) {
  return proxyBackend(context.request, context.env, "/api/admin/status");
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response(JSON.stringify({ success: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "allow": "GET" }
  });
}
