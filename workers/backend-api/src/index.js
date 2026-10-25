import { verifyAdminRequest } from "./access.js";
import { syncFilesToGitHub } from "./github-sync.js";
import { analyzeProjectFiles } from "../../self-healing-bot/src/index.js";
import { proposeSafePatches } from "../../self-healing-bot/src/llm-analyzer.js";
import { normalizeAppMetadata } from "../../../packages/shared-types/src/index.js";

const API = "https://api.github.com";
const MAX_BODY = 10 * 1024 * 1024;
const allowedExtensions = new Set([".apk", ".ipa", ".exe", ".zip", ".plist", ".msi", ".msix", ".dmg", ".pkg", ".aab"]);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allow = new Set(String(env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean));
  if (origin && (origin === new URL(request.url).origin || allow.has(origin))) {
    return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" };
  }
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
function xmlEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function apiOrigin(request, env) {
  return String(env.PUBLIC_API_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
}
async function readCatalogObject(bucket, key) {
  if (!bucket || !key || !key.startsWith("catalog/")) return null;
  const object = await bucket.get(key);
  if (!object) return null;
  try { return await object.json(); } catch { return null; }
}
async function listCatalog(env) {
  if (!env.RELEASES_BUCKET) return { releases: [], storageReady: false };
  if (env.CONFIG_CACHE) {
    try {
      const cached = await env.CONFIG_CACHE.get("public:release-catalog:v1", "json");
      if (cached && Array.isArray(cached.releases)) return cached;
    } catch { /* cache miss: R2 remains the source of truth */ }
  }
  const releases = [];
  let cursor;
  let pageCount = 0;
  do {
    const page = await env.RELEASES_BUCKET.list({ prefix: "catalog/", limit: 1000, cursor });
    for (const item of page.objects || []) {
      const metadata = await readCatalogObject(env.RELEASES_BUCKET, item.key);
      if (!metadata || metadata.public !== true || !metadata.objectKey || !String(metadata.objectKey).startsWith("artifacts/")) continue;
      releases.push(metadata);
    }
    cursor = page.truncated ? page.cursor : undefined;
    pageCount++;
  } while (cursor && pageCount < 10);
  releases.sort((a,b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  const result = { releases, storageReady: true, truncated: !!cursor };
  if (env.CONFIG_CACHE) {
    try { await env.CONFIG_CACHE.put("public:release-catalog:v1", JSON.stringify(result), { expirationTtl: 60 }); } catch { /* optional cache */ }
  }
  return result;
}
async function listReleases(env, request) {
  const result = await listCatalog(env);
  const origin = apiOrigin(request, env);
  const releases = result.releases.map((item) => ({
    ...item,
    downloadUrl: origin + "/api/download?key=" + encodeURIComponent(item.objectKey),
    manifestUrl: item.platform === "ios" ? origin + "/api/releases/ios-manifest?id=" + encodeURIComponent(item.id) : undefined
  }));
  return json({ success: true, releases, storageReady: result.storageReady, truncated: result.truncated || false });
}
async function findPublicReleaseByObjectKey(env, key) {
  const catalog = await listCatalog(env);
  return catalog.releases.find((item) => item.objectKey === key && item.public === true) || null;
}
async function downloadRelease(url, env) {
  if (!env.RELEASES_BUCKET) return json({ success: false, error: "release_storage_unavailable" }, 503);
  const key = String(url.searchParams.get("key") || "");
  if (!key.startsWith("artifacts/") || key.includes("..") || key.includes("\\")) return json({ success: false, error: "invalid_artifact_key" }, 400);
  const catalogItem = await findPublicReleaseByObjectKey(env, key);
  if (!catalogItem) return json({ success: false, error: "public_release_not_found" }, 404);
  const object = await env.RELEASES_BUCKET.get(key);
  if (!object) return json({ success: false, error: "artifact_not_found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", `attachment; filename="${String(catalogItem.filename || key.split("/").pop()).replace(/["\\\r\n]/g, "_")}"`);
  return new Response(object.body, { headers });
}
async function iosManifest(url, env, request) {
  const id = String(url.searchParams.get("id") || "");
  if (!id || !env.RELEASES_BUCKET) return json({ success: false, error: "release_id_or_storage_missing" }, 400);
  const item = await readCatalogObject(env.RELEASES_BUCKET, "catalog/" + id + ".json");
  if (!item || item.public !== true || item.platform !== "ios" || !item.objectKey) return json({ success: false, error: "public_ios_release_not_found" }, 404);
  const origin = apiOrigin(request, env);
  const assetUrl = origin + "/api/download?key=" + encodeURIComponent(item.objectKey);
  const bundleId = String(item.bundleIdentifier || env.IOS_BUNDLE_IDENTIFIER || "com.hendy.appstore.ios");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>items</key><array><dict><key>assets</key><array>
<dict><key>kind</key><string>software-package</string><key>url</key><string>${xmlEscape(assetUrl)}</string></dict>
</array><key>metadata</key><dict>
<key>bundle-identifier</key><string>${xmlEscape(bundleId)}</string>
<key>bundle-version</key><string>${xmlEscape(item.version || "1.0.0")}</string>
<key>kind</key><string>software</string>
<key>title</key><string>${xmlEscape(item.appName || "Hendy App Store")}</string>
</dict></dict></array></dict></plist>`;
  return new Response(plist, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });
}
async function uploadRelease(body, env, auth) {
  if (!env.RELEASES_BUCKET) return json({ success: false, error: "release_storage_unavailable" }, 503);
  const filename = String(body.filename || "").split(/[\\/]/).pop();
  const ext = "." + (filename.split(".").pop() || "").toLowerCase();
  if (!allowedExtensions.has(ext)) return json({ success: false, error: "unsupported_artifact_extension" }, 400);
  const platform = String(body.platform || "").toLowerCase();
  if (!["android","ios","windows","macos","web"].includes(platform)) return json({ success: false, error: "unsupported_platform" }, 400);
  const base64 = String(body.contentBase64 || "");
  if (!base64 || base64.length > 8 * 1024 * 1024 * 4 / 3) return json({ success: false, error: "artifact_too_large_or_empty" }, 413);
  let bytes;
  try { const raw = atob(base64.replace(/\s/g, "")); bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
  catch { return json({ success: false, error: "invalid_base64" }, 400); }
  if (bytes.byteLength > 8 * 1024 * 1024) return json({ success: false, error: "artifact_limit_8_mib_use_r2_cli_for_large_files" }, 413);
  const id = crypto.randomUUID();
  const objectKey = `artifacts/${platform}/${id}/${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = [...hash].map((b) => b.toString(16).padStart(2,"0")).join("");
  await env.RELEASES_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: body.contentType || "application/octet-stream" }, customMetadata: { sha256, platform, version: String(body.version || "0.0.0") } });
  const metadata = {
    id, appName: String(body.appName || "Hendy App").slice(0, 120), description: String(body.description || "").slice(0, 500),
    filename, version: String(body.version || "0.0.0").slice(0, 64), platform, objectKey, sha256,
    size: bytes.byteLength, uploadedAt: new Date().toISOString(), publishedAt: null, public: false,
    uploadedBy: auth.email, signatureStatus: "unverified",
    publicationNote: "Draft only. The verified signing workflow is responsible for public catalog entries."
  };
  await env.RELEASES_BUCKET.put(`catalog/${id}.json`, JSON.stringify(metadata), { httpMetadata: { contentType: "application/json" } });
  if (env.DB) {
    try {
      await env.DB.prepare("INSERT INTO release_metadata (id, app_name, version, platform, filename, object_key, sha256, size_bytes, is_public, signature_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'unverified', ?)")
        .bind(id, metadata.appName, metadata.version, metadata.platform, metadata.filename, objectKey, sha256, bytes.byteLength, new Date().toISOString()).run();
    } catch { /* R2 remains the artifact source of truth; report is still a draft */ }
  }
  return json({ success: true, release: metadata, note: "SHA-256 calculated. Upload remains private until verified signing/publication." }, 201);
}
async function githubApi(path, env, init = {}) {
  if (!env.GITHUB_SYNC_TOKEN) throw new Error("GITHUB_SYNC_TOKEN is not configured.");
  const owner = String(env.GITHUB_OWNER || "");
  const repo = String(env.GITHUB_REPO || "");
  const response = await fetch(`${API}/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: { Authorization: "Bearer " + env.GITHUB_SYNC_TOKEN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("GitHub API returned HTTP " + response.status + ": " + String(data.message || "request failed").slice(0, 300));
  return data;
}
async function getBuildStatus(env) {
  const builds = [];
  if (env.GITHUB_SYNC_TOKEN) {
    try {
      const result = await githubApi("/actions/runs?per_page=15", env);
      for (const item of result.workflow_runs || []) {
        const conclusion = item.conclusion || item.status || "unknown";
        builds.push({
          id: String(item.id), runId: item.id, workflow: item.name, platform: "matrix",
          status: conclusion === "failure" ? "failed" : conclusion,
          commitSha: item.head_sha, headSha: item.head_sha, createdAt: item.created_at,
          startedAt: item.run_started_at || item.created_at, completedAt: item.updated_at,
          htmlUrl: item.html_url, event: item.event
        });
      }
    } catch { /* fall back to D1 history */ }
  }
  if (env.DB) {
    const result = await env.DB.prepare("SELECT id, run_id AS runId, workflow, platform, status, commit_sha AS commitSha, created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt, html_url AS htmlUrl, error_message AS errorMessage FROM build_history ORDER BY created_at DESC LIMIT 25").all();
    const seen = new Set(builds.map((item) => String(item.id)));
    for (const item of result.results || []) if (!seen.has(String(item.id))) builds.push(item);
  }
  builds.sort((a,b) => String(b.createdAt || b.startedAt || "").localeCompare(String(a.createdAt || a.startedAt || "")));
  return builds.slice(0, 25);
}

async function saveApp(body, auth, env) {
  if (!env.DB) throw new Error("D1 database binding is missing.");
  const app = normalizeAppMetadata(body);
  const now = new Date().toISOString();
  const current = await env.DB.prepare("SELECT id, created_at FROM apps WHERE id = ? OR slug = ? LIMIT 1").bind(app.id, app.slug).first();
  if (current?.id && !body.id) app.id = current.id;
  await env.DB.prepare("INSERT INTO apps (id, slug, name, description, category, icon_url, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, description=excluded.description, category=excluded.category, icon_url=excluded.icon_url, visibility=excluded.visibility, updated_at=excluded.updated_at")
    .bind(app.id, app.slug, app.name, app.description, app.category, app.iconUrl, app.visibility, current?.created_at || now, now).run();
  return { ...app, createdAt: current?.created_at || now, updatedAt: now, updatedBy: auth.email };
}
async function listPublicApps(env) {
  if (!env.DB) return json({ success: true, apps: [], storageReady: false });
  const result = await env.DB.prepare("SELECT id, slug, name, description, category, icon_url AS iconUrl, visibility, created_at AS createdAt, updated_at AS updatedAt FROM apps WHERE visibility='public' ORDER BY updated_at DESC LIMIT 500").all();
  return json({ success: true, apps: result.results || [], storageReady: true });
}
async function listApps(env) {
  if (!env.DB) return json({ success: false, error: "d1_not_configured", apps: [] }, 503);
  const result = await env.DB.prepare("SELECT id, slug, name, description, category, icon_url AS iconUrl, visibility, created_at AS createdAt, updated_at AS updatedAt FROM apps ORDER BY updated_at DESC LIMIT 500").all();
  return json({ success: true, apps: result.results || [] });
}
async function enqueueBuild(body, auth, env) {
  if (!env.BUILD_QUEUE || !env.DB) throw new Error("D1 and BUILD_QUEUE bindings are required for queued builds.");
  const sourceRef = String(body.sourceRef || env.GITHUB_BRANCH || "main");
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(sourceRef) || sourceRef.includes("..")) throw new Error("Invalid sourceRef.");
  const platform = ["android","ios","macos","windows","matrix"].includes(String(body.platform || "matrix")) ? String(body.platform || "matrix") : "matrix";
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO build_history (id, workflow, platform, status, commit_sha, requested_by, source_ref, created_at) VALUES (?, 'Hendy App Store — Multi-OS Build Matrix', ?, 'queued', '', ?, ?, ?)")
    .bind(id, platform, auth.email, sourceRef, now).run();
  await env.DB.prepare("INSERT INTO build_events (build_id, event_type, status, details_json, created_at) VALUES (?, 'requested', 'queued', ?, ?)")
    .bind(id, JSON.stringify({ platform, sourceRef, requestedBy: auth.email }), now).run();
  await env.BUILD_QUEUE.send({ buildId: id, requestedAt: now, requestedBy: auth.email, sourceRef, platform });
  return { id, platform, sourceRef, status: "queued", createdAt: now };
}
async function dispatchBuildToGitHub(message, env) {
  const owner = String(env.GITHUB_OWNER || "");
  const repo = String(env.GITHUB_REPO || "");
  const ref = String(message.sourceRef || env.GITHUB_BRANCH || "main");
  const requestedTarget = String(message.platform || "matrix");
  const target = requestedTarget === "matrix" ? "all" : requestedTarget;
  const result = await githubApi("/actions/workflows/matrix-build.yml/dispatches", env, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, inputs: { publish_signed: "false", source_ref: ref, build_id: String(message.buildId || ""), target } })
  });
  if (env.DB && message.buildId) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE build_history SET status='in_progress', commit_sha=?, started_at=? WHERE id=?")
      .bind(String(message.commitSha || ""), now, message.buildId).run();
    await env.DB.prepare("INSERT INTO build_events (build_id, event_type, status, details_json, created_at) VALUES (?, 'dispatched', 'in_progress', ?, ?)")
      .bind(message.buildId, JSON.stringify({ workflow: "matrix-build.yml", sourceRef: ref }), now).run();
  }
  return result;
}
function isAutoHealSourcePath(path) {
  const value = String(path || "").replace(/\\\\/g, "/");
  return /^(apps|workers|packages|scripts)\//.test(value)
    && /\\.(?:js|mjs|cjs|ts|tsx|jsx|css|html|sql)$/i.test(value)
    && !/(^|\\/)\\.github(\\/|$)/i.test(value)
    && !/(^|\\/)(node_modules|dist|coverage)(\\/|$)/i.test(value);
}
function decodeGithubBase64(value) {
  const encoded = String(value || "").replace(/\\s+/g, "");
  const raw = atob(encoded);
  const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function redactBuildLogs(value) {
  return String(value || "")
    .replace(/(authorization\\s*:\\s*bearer\\s+)[^\\s]+/gi, "$1[REDACTED]")
    .replace(/\\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\\b/g, "[REDACTED]")
    .replace(/((?:TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)\\s*[:=]\\s*)[^\\r\\n]+/gi, "$1[REDACTED]");
}
async function fetchGithubBuildLogs(runId, env) {
  const data = await githubApi("/actions/runs/" + encodeURIComponent(String(runId)) + "/jobs?per_page=100", env);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const failed = jobs.filter((job) => job.conclusion === "failure" || job.conclusion === "timed_out" || job.conclusion === "action_required");
  const selected = (failed.length ? failed : jobs.filter((job) => job.status === "completed").slice(-3)).slice(0, 4);
  if (!selected.length) return "GitHub Actions did not return completed job records for this run.";
  const chunks = [];
  for (const job of selected) {
    try {
      const owner = String(env.GITHUB_OWNER || "");
      const repo = String(env.GITHUB_REPO || "");
      const response = await fetch(API + "/repos/" + owner + "/" + repo + "/actions/jobs/" + encodeURIComponent(String(job.id)) + "/logs", {
        headers: { Authorization: "Bearer " + env.GITHUB_SYNC_TOKEN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        redirect: "follow"
      });
      if (!response.ok) {
        chunks.push("JOB " + String(job.name || job.id) + ": GitHub log request returned HTTP " + response.status + ".");
        continue;
      }
      let text = await response.text();
      if (text.startsWith("PK\\u0003\\u0004")) {
        chunks.push("JOB " + String(job.name || job.id) + ": log archive was returned as ZIP; raw text logs were not available.");
        continue;
      }
      text = redactBuildLogs(text);
      chunks.push("JOB " + String(job.name || job.id) + " (" + String(job.conclusion || job.status || "unknown") + ")\\n" + text.slice(-9000));
    } catch (error) {
      chunks.push("JOB " + String(job.name || job.id) + ": could not fetch logs (" + String(error.message || error).slice(0, 200) + ").");
    }
  }
  return chunks.join("\\n\\n").slice(-28000);
}
async function fetchChangedSourceFiles(commitSha, env) {
  const commit = await githubApi("/commits/" + encodeURIComponent(commitSha), env);
  const candidates = (Array.isArray(commit.files) ? commit.files : [])
    .filter((file) => file.status !== "removed" && isAutoHealSourcePath(file.filename))
    .slice(0, 24);
  const files = [];
  let totalChars = 0;
  for (const file of candidates) {
    const path = String(file.filename);
    try {
      const result = await githubApi("/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(commitSha), env);
      if (result.encoding !== "base64" || typeof result.content !== "string" || Number(result.size || 0) > 12000) continue;
      const text = decodeGithubBase64(result.content);
      if (text.includes("\\u0000") || text.length > 12000 || totalChars + text.length > 42000) continue;
      files.push({ path, content: text });
      totalChars += text.length;
    } catch {
      // A deleted, binary, too-large, or inaccessible file is not sent to the LLM.
    }
  }
  return files;
}
function hexBytes(value) {
  const clean = String(value || "").replace(/^sha256=/i, "").trim();
  if (!/^[a-f0-9]{64}$/i.test(clean)) return null;
  return Uint8Array.from(clean.match(/.{2}/g), (pair) => parseInt(pair, 16));
}
async function verifySelfHealHmac(rawBody, supplied, secret) {
  const signature = hexBytes(supplied);
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ signature[i];
  return diff === 0;
}
async function handleSelfHealWebhook(request, env) {
  const secret = String(env.SELF_HEAL_WEBHOOK_SECRET || "");
  if (!secret) return json({ success: false, error: "self_heal_webhook_not_configured" }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 128 * 1024) return json({ success: false, error: "webhook_payload_too_large" }, 413);
  if (!await verifySelfHealHmac(raw, request.headers.get("x-hendy-self-heal-signature"), secret)) return json({ success: false, error: "invalid_self_heal_signature" }, 401);
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch { return json({ success: false, error: "invalid_json" }, 400); }
  const runId = Number(payload.runId || payload.workflow_run?.id || 0);
  const commitSha = String(payload.commitSha || payload.workflow_run?.head_sha || "");
  const sourceRef = String(payload.sourceRef || payload.workflow_run?.head_branch || "main");
  const conclusion = String(payload.conclusion || payload.workflow_run?.conclusion || "");
  if (!Number.isSafeInteger(runId) || runId <= 0 || !/^[a-f0-9]{40}$/i.test(commitSha)) return json({ success: false, error: "invalid_build_reference" }, 400);
  if (!["failure", "timed_out"].includes(conclusion)) return json({ success: true, status: "skipped", reason: "build_is_not_failed" });
  if (String(env.AUTO_HEAL_ENABLED || "") !== "true") return json({ success: true, status: "skipped", reason: "auto_heal_disabled" });
  if (!env.DB) return json({ success: false, error: "d1_not_configured" }, 503);
  const configuredBranch = String(env.GITHUB_BRANCH || "main");
  if (sourceRef !== configuredBranch) return json({ success: true, status: "skipped", reason: "auto_heal_only_runs_on_configured_branch" });
  const prior = await env.DB.prepare("SELECT id, status, patch_commit_sha FROM self_heal_attempts WHERE run_id = ?").bind(runId).first();
  if (prior) return json({ success: true, status: prior.status, duplicate: true, patchCommitSha: prior.patch_commit_sha || "" });
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const budget = await env.DB.prepare("SELECT COUNT(*) AS total FROM self_heal_attempts WHERE created_at >= ?").bind(since).first();
  if (Number(budget?.total || 0) >= 3) return json({ success: true, status: "rate_limited", reason: "maximum_three_auto_heal_attempts_per_hour" }, 429);
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO self_heal_attempts (id, run_id, commit_sha, source_ref, status, patch_count, patch_commit_sha, diagnostics_json, created_at) VALUES (?, ?, ?, ?, 'started', 0, '', '{}', ?)")
    .bind(auditId, runId, commitSha, sourceRef, now).run();
  try {
    const logs = await fetchGithubBuildLogs(runId, env);
    const files = await fetchChangedSourceFiles(commitSha, env);
    if (!files.length) {
      await env.DB.prepare("UPDATE self_heal_attempts SET status='skipped', diagnostics_json=?, completed_at=? WHERE id=?")
        .bind(JSON.stringify({ reason: "no_eligible_changed_source_files", logSummary: logs.slice(-3000) }), new Date().toISOString(), auditId).run();
      return json({ success: true, status: "skipped", reason: "no_eligible_changed_source_files" });
    }
    const diagnostics = [{ severity: "error", code: "GITHUB_ACTIONS_BUILD_FAILURE", message: logs }];
    const proposal = await proposeSafePatches(files, diagnostics, env);
    if (!proposal.patches.length) {
      await env.DB.prepare("UPDATE self_heal_attempts SET status='skipped', diagnostics_json=?, completed_at=? WHERE id=?")
        .bind(JSON.stringify({ summary: proposal.summary, diagnostics: diagnostics.map((d) => ({ code: d.code, severity: d.severity, logExcerpt: d.message.slice(-2500) })) }), new Date().toISOString(), auditId).run();
      return json({ success: true, status: "skipped", reason: "llm_returned_no_safe_patch", summary: proposal.summary });
    }
    const committed = await syncFilesToGitHub(proposal.patches.map(({ path, content }) => ({ path, content })), env);
    const completed = new Date().toISOString();
    const report = {
      summary: proposal.summary,
      patches: proposal.patches.map((p) => ({ path: p.path, rationale: p.rationale })),
      logExcerpt: logs.slice(-2500),
      rebuildTriggered: true
    };
    await env.DB.prepare("UPDATE self_heal_attempts SET status='applied', patch_count=?, patch_commit_sha=?, diagnostics_json=?, completed_at=? WHERE id=?")
      .bind(proposal.patches.length, committed.commitSha, JSON.stringify(report), completed, auditId).run();
    return json({ success: true, status: "applied", runId, patchCount: proposal.patches.length, commitSha: committed.commitSha, commitUrl: committed.commitUrl, rebuildTriggered: true }, 201);
  } catch (error) {
    const message = String(error?.message || error).replace(/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})/g, "[REDACTED]").slice(0, 1000);
    await env.DB.prepare("UPDATE self_heal_attempts SET status='failed', error_message=?, completed_at=? WHERE id=?")
      .bind(message, new Date().toISOString(), auditId).run();
    return json({ success: false, status: "failed", error: message }, 500);
  }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method === "GET" && path === "/api/health") return json({ success: true, service: "hendy-app-store-api", status: "healthy", time: new Date().toISOString() });
  if (request.method === "GET" && path === "/api/runtime/readiness") return json({ success: true, service: "hendy-app-store-api", bindings: { D1: !!env.DB, KV: !!env.CONFIG_CACHE, R2: !!env.RELEASES_BUCKET, Queue: !!env.BUILD_QUEUE, GitHubSync: !!env.GITHUB_SYNC_TOKEN } });
  if (request.method === "GET" && path === "/api/releases") return listReleases(env, request);
  if (request.method === "GET" && path === "/api/apps") return listPublicApps(env);
  if (request.method === "GET" && path === "/api/releases/ios-manifest") return iosManifest(url, env, request);
  if (request.method === "GET" && path === "/api/download") return downloadRelease(url, env);
  if (request.method === "POST" && path === "/api/internal/self-heal") return handleSelfHealWebhook(request, env);

  const protectedPaths = path.startsWith("/api/admin/") || path === "/api/admin/status" || path === "/api/analyze" || path === "/api/github/sync" || path === "/api/releases/upload" || path === "/api/build/queue" || path === "/api/self-heal/llm";
  if (protectedPaths) {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth;
    if (request.method === "GET" && path === "/api/admin/status") return json({ success: true, authenticated: true, email: auth.email });
    if (request.method === "GET" && path === "/api/admin/builds") return json({ success: true, builds: await getBuildStatus(env) });
    if (request.method === "GET" && path === "/api/admin/apps") return listApps(env);
    if (request.method === "POST" && path === "/api/admin/apps") {
      const body = await readJson(request);
      try { return json({ success: true, app: await saveApp(body, auth, env) }, 201); }
      catch (error) { return json({ success: false, error: error.message }, 400); }
    }
    if (request.method === "POST" && path === "/api/analyze") {
      const body = await readJson(request);
      const result = analyzeProjectFiles(body.files || [], { repair: body.repair === true });
      return json(result, 200);
    }
    if (request.method === "POST" && path === "/api/self-heal/llm") {
      const body = await readJson(request);
      try {
        const analysis = analyzeProjectFiles(body.files || [], { repair: false });
        const proposal = await proposeSafePatches(body.files || [], body.diagnostics || analysis.diagnostics, env);
        if (body.apply === true && String(env.AUTO_HEAL_ENABLED || "") === "true" && proposal.patches.length) {
          const commit = await syncFilesToGitHub(proposal.patches.map(({ path, content }) => ({ path, content })), env);
          return json({ success: true, ...proposal, applied: true, commit, rebuildTriggered: true }, 201);
        }
        return json({ success: true, ...proposal, applied: false, note: "Review the patch before applying. Set AUTO_HEAL_ENABLED=true and explicitly request apply to commit safe source changes." });
      } catch (error) { return json({ success: false, error: error.message }, 400); }
    }
    if (request.method === "POST" && path === "/api/github/sync") {
      const body = await readJson(request);
      try {
        const result = await syncFilesToGitHub(body.files || [], env);
        if (env.DB) {
          const now = new Date().toISOString();
          try { await env.DB.prepare("INSERT INTO source_sync_logs (id, commit_sha, file_count, requested_by, created_at, status) VALUES (?, ?, ?, ?, ?, 'success')")
            .bind(crypto.randomUUID(), result.commitSha, result.fileCount, auth.email, now).run(); } catch { /* commit succeeds even if audit insert fails */ }
        }
        return json({ success: true, ...result, ciTriggeredByPush: true }, 201);
      } catch (error) { return json({ success: false, error: error.message, code: error.status || 0 }, error.status === 409 ? 409 : 400); }
    }
    if (request.method === "POST" && path === "/api/releases/upload") return uploadRelease(await readJson(request), env, auth);
    if (request.method === "POST" && path === "/api/build/queue") {
      try { return json({ success: true, build: await enqueueBuild(await readJson(request), auth, env) }, 202); }
      catch (error) { return json({ success: false, error: error.message }, 503); }
    }
    return json({ success: false, error: "route_not_found" }, 404);
  }
  return json({ success: false, error: "route_not_found" }, 404);
}
export default {
  async fetch(request, env) {
    try { return withCors(await handle(request, env), request, env); }
    catch (error) { return withCors(json({ success: false, error: "internal_error", detail: error instanceof Error ? error.message : "Unexpected error" }, 500), request, env); }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await dispatchBuildToGitHub(message.body || {}, env);
        message.ack();
      } catch (error) {
        if (env.DB && message.body?.buildId) {
          try {
            await env.DB.prepare("UPDATE build_history SET status='queued', error_message=? WHERE id=?").bind(String(error.message || "Queue dispatch failed").slice(0, 1000), message.body.buildId).run();
          } catch { /* Preserve retry behavior even if audit storage is unavailable. */ }
        }
        message.retry({ delaySeconds: 60 });
      }
    }
  }
};
