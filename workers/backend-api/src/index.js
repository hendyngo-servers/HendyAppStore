import { verifyAdminRequest } from "./access.js";
import { syncFilesToGitHub } from "./github-sync.js";
import { analyzeProjectFiles } from "../../self-healing-bot/src/index.js";

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const MAX_BODY = 10 * 1024 * 1024;
const allowedExtensions = new Set([".apk", ".ipa", ".exe", ".zip", ".plist", ".msi", ".msix"]);
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allow = new Set(String(env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean));
  if (origin && (origin === new URL(request.url).origin || allow.has(origin))) return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" };
  return {};
}
function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request, env)).forEach(([k,v]) => headers.set(k,v));
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,CF-Access-JWT-Assertion");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) throw new Error("Request body exceeds 10 MiB.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) throw new Error("Request body exceeds 10 MiB.");
  try { return JSON.parse(text || "{}"); } catch { throw new Error("Body must be valid JSON."); }
}
async function requireAdmin(request, env) {
  const result = await verifyAdminRequest(request, env);
  if (!result.ok) return json({ success: false, error: result.error, detail: result.detail }, result.status);
  return result;
}
async function listReleases(env, request) {
  if (!env.RELEASES_BUCKET) return json({ success: true, releases: [], storageReady: false });
  const listing = await env.RELEASES_BUCKET.list({ prefix: "catalog/", limit: 100 });
  const releases = [];
  for (const object of listing.objects || []) {
    const stored = await env.RELEASES_BUCKET.get(object.key);
    if (!stored) continue;
    try {
      const item = await stored.json();
      if (item.public !== true || !item.objectKey) continue;
      const origin = String(env.PUBLIC_API_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
      releases.push({ ...item, downloadUrl: origin + "/api/download?key=" + encodeURIComponent(item.objectKey) });
    } catch { /* ignore malformed catalog metadata */ }
  }
  releases.sort((a,b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  return json({ success: true, releases, storageReady: true });
}
async function downloadRelease(url, env) {
  if (!env.RELEASES_BUCKET) return json({ success: false, error: "release_storage_unavailable" }, 503);
  const key = String(url.searchParams.get("key") || "");
  if (!key.startsWith("artifacts/") || key.includes("..") || key.includes("\\")) return json({ success: false, error: "invalid_artifact_key" }, 400);
  const object = await env.RELEASES_BUCKET.get(key);
  if (!object) return json({ success: false, error: "artifact_not_found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", `attachment; filename="${key.split("/").pop().replace(/["\\\r\n]/g, "_")}"`);
  return new Response(object.body, { headers });
}
async function uploadRelease(body, env) {
  if (!env.RELEASES_BUCKET) return json({ success: false, error: "release_storage_unavailable" }, 503);
  const filename = String(body.filename || "").split(/[\\/]/).pop();
  const ext = "." + (filename.split(".").pop() || "").toLowerCase();
  if (!allowedExtensions.has(ext)) return json({ success: false, error: "unsupported_artifact_extension" }, 400);
  const platform = String(body.platform || "").toLowerCase();
  if (!["android","ios","windows","web"].includes(platform)) return json({ success: false, error: "unsupported_platform" }, 400);
  const base64 = String(body.contentBase64 || "");
  if (!base64 || base64.length > 12 * 1024 * 1024 * 4 / 3) return json({ success: false, error: "artifact_too_large_or_empty" }, 413);
  let bytes;
  try {
    const raw = atob(base64.replace(/\s/g, ""));
    bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch { return json({ success: false, error: "invalid_base64" }, 400); }
  if (bytes.byteLength > 8 * 1024 * 1024) return json({ success: false, error: "artifact_limit_8_mib" }, 413);
  const id = crypto.randomUUID();
  const objectKey = `artifacts/${platform}/${id}/${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = [...hash].map((b) => b.toString(16).padStart(2,"0")).join("");
  await env.RELEASES_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: body.contentType || "application/octet-stream" }, customMetadata: { sha256, platform, version: String(body.version || "0.0.0") } });
  const metadata = {
    id, appName: String(body.appName || "Hendy App").slice(0, 120), description: String(body.description || "").slice(0, 500),
    filename, version: String(body.version || "0.0.0").slice(0, 64), platform, objectKey, sha256,
    size: bytes.byteLength, uploadedAt: new Date().toISOString(), public: false,
    signatureStatus: "not-verified-by-api",
    publicationNote: "Draft only. Public catalog entries must be written by the protected signing-verification workflow."
  };
  await env.RELEASES_BUCKET.put(`catalog/${id}.json`, JSON.stringify(metadata), { httpMetadata: { contentType: "application/json" } });
  return json({ success: true, release: metadata, note: "SHA-256 calculated. This API does not claim to verify platform signatures." }, 201);
}
async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method === "GET" && path === "/api/health") return json({ success: true, service: "hendy-app-store-api", status: "healthy", time: new Date().toISOString() });
  if (request.method === "GET" && path === "/api/releases") return listReleases(env, request);
  if (request.method === "GET" && path === "/api/download") return downloadRelease(url, env);

  if (path.startsWith("/api/admin/") || path === "/api/admin/status" || path === "/api/analyze" || path === "/api/github/sync" || path === "/api/releases/upload" || path === "/api/build/queue") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth;
    if (request.method === "GET" && path === "/api/admin/status") return json({ success: true, authenticated: true, email: auth.email });
    if (request.method === "POST" && path === "/api/analyze") {
      const body = await readJson(request);
      const result = analyzeProjectFiles(body.files || [], { repair: body.repair === true });
      // Always return diagnostics as JSON so the Admin UI can display invalid-source reports.
      return json(result, 200);
    }
    if (request.method === "POST" && path === "/api/github/sync") {
      const body = await readJson(request);
      try { return json({ success: true, ...(await syncFilesToGitHub(body.files || [], env)), ciTriggeredByPush: true }, 201); }
      catch (error) { return json({ success: false, error: error.message, code: error.status || 0 }, error.status === 409 ? 409 : 400); }
    }
    if (request.method === "POST" && path === "/api/releases/upload") return uploadRelease(await readJson(request), env);
    if (request.method === "POST" && path === "/api/build/queue") {
      if (env.BUILD_QUEUE) {
        const body = await readJson(request);
        await env.BUILD_QUEUE.send({ requestedAt: new Date().toISOString(), requestedBy: auth.email, sourceRef: String(body.sourceRef || env.GITHUB_BRANCH || "main") });
        return json({ success: true, queued: true }, 202);
      }
      return json({ success: false, error: "build_queue_not_configured", detail: "A BUILD_QUEUE binding is optional. A GitHub source-sync push automatically starts the matrix-build workflow." }, 503);
    }
    return json({ success: false, error: "route_not_found" }, 404);
  }
  return json({ success: false, error: "route_not_found" }, 404);
}
export default {
  async fetch(request, env) {
    try { return withCors(await handle(request, env), request, env); }
    catch (error) { return withCors(json({ success: false, error: "internal_error", detail: error instanceof Error ? error.message : "Unexpected error" }, 500), request, env); }
  }
};
