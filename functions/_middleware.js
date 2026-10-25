import { backendOrigin, json } from "./_lib/backend.js";

const isAdminPath = (path) =>
  path === "/admin" || path.startsWith("/admin/") ||
  path === "/web-admin" || path.startsWith("/web-admin/") ||
  path.startsWith("/api/admin/") || path === "/api/admin/status" ||
  path === "/api/auth" || path === "/api/sync-logs";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Pages Functions must not serve the CMS when its upstream Access validator is absent.
  if (!isAdminPath(url.pathname)) return context.next();

  const origin = backendOrigin(env);
  if (!origin) return json({ success: false, error: "admin_backend_not_configured" }, 503);

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  const checkUrl = new URL("/api/admin/status", origin);
  const check = await fetch(checkUrl, { method: "GET", headers, redirect: "manual" });
  if (!check.ok) {
    return new Response("Admin Studio requires an authenticated Cloudflare Access session.", {
      status: check.status === 503 ? 503 : 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "same-origin"
      }
    });
  }
  return context.next();
}
