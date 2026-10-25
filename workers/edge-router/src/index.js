function detectClientFromUserAgent(userAgent = "") {
  const ua = String(userAgent).toLowerCase();
  let os = "unknown";
  if (/iphone|ipad|ipod/.test(ua)) os = "ios";
  else if (/android/.test(ua)) os = "android";
  else if (/windows phone|windows nt/.test(ua)) os = "windows";
  else if (/cros/.test(ua)) os = "chromeos";
  else if (/macintosh|mac os x/.test(ua)) os = "macos";
  else if (/linux|x11/.test(ua)) os = "linux";
  let device = "desktop";
  if (/ipad|tablet/.test(ua) || (ua.includes("android") && !ua.includes("mobile"))) device = "tablet";
  else if (/android|iphone|ipod|mobile|windows phone/.test(ua)) device = "mobile";
  return { os, device };
}
function addClientHeaders(headers, request) {
  const detected = detectClientFromUserAgent(request.headers.get("User-Agent") || "");
  headers.set("X-Hendy-Client-OS", detected.os);
  headers.set("X-Hendy-Device-Class", detected.device);
  const vary = new Set(String(headers.get("Vary") || "").split(",").map((value) => value.trim()).filter(Boolean));
  vary.add("User-Agent");
  headers.set("Vary", [...vary].join(", "));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function pathWith(path, url) {
  const target = new URL(url);
  target.pathname = path;
  target.search = "";
  return target;
}
async function adminAccessCheck(request, env) {
  if (!env.BACKEND_API) return { allowed: false, response: json({ success: false, error: "backend_service_binding_missing" }, 503) };
  const url = new URL(request.url);
  url.pathname = "/api/admin/status";
  url.search = "";
  const response = await env.BACKEND_API.fetch(new Request(url.toString(), { method: "GET", headers: request.headers }));
  if (!response.ok) return { allowed: false, response: new Response("Admin Studio requires an authenticated Cloudflare Access session. Open this URL through the configured Access policy.", { status: response.status === 503 ? 503 : 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }) };
  return { allowed: true };
}
function isAdminHost(request, env) {
  const host = new URL(request.url).hostname.toLowerCase();
  const configured = String(env.ADMIN_HOSTNAMES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return configured.includes(host) || host.startsWith("admin.");
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/healthz") return env.BACKEND_API ? env.BACKEND_API.fetch(new Request(new URL("/api/health", request.url), request)) : json({ success: false, error: "backend_unavailable" }, 503);
    if (path === "/api" || path.startsWith("/api/")) {
      if (!env.BACKEND_API) return json({ success: false, error: "backend_service_binding_missing" }, 503);
      return env.BACKEND_API.fetch(request);
    }

    const adminRequest = path === "/admin" || path.startsWith("/admin/") || path === "/web-admin" || path.startsWith("/web-admin/") || isAdminHost(request, env);
    if (adminRequest) {
      const gate = await adminAccessCheck(request, env);
      if (!gate.allowed) return gate.response;
      let assetPath = path;
      if (path === "/admin" || path === "/admin/") assetPath = "/web-admin/index.html";
      else if (path.startsWith("/admin/")) assetPath = "/web-admin/" + path.slice("/admin/".length);
      else if (isAdminHost(request, env) && (path === "/" || path === "/index.html")) assetPath = "/web-admin/index.html";
      else if (path === "/web-admin") assetPath = "/web-admin/index.html";
      const assetUrl = new URL(assetPath, request.url);
      const assetRequest = new Request(assetUrl, request);
      const response = await env.STATIC_ASSETS.fetch(assetRequest);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", assetPath.endsWith(".html") ? "no-store" : "private, max-age=300");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "same-origin");
      headers.set("X-Frame-Options", "DENY");
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net; worker-src blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      addClientHeaders(headers, request);
      return new Response(response.body, { status: response.status, headers });
    }

    let assetPath = path;
    if (path === "/" || path === "/index.html") assetPath = "/web-user/index.html";
    else if (!path.startsWith("/web-user/")) {
      // Keep direct public file URLs rooted inside the web-user bundle.
      assetPath = "/web-user" + (path.startsWith("/") ? path : "/" + path);
    }
    const response = await env.STATIC_ASSETS.fetch(new Request(pathWith(assetPath, request.url), request));
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    addClientHeaders(headers, request);
    return new Response(response.body, { status: response.status, headers });
  }
};
