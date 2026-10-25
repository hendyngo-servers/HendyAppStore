import { verifyAdminRequest } from "./access.js";
import { syncFilesToGitHub } from "./github-sync.js";
import { analyzeProjectFiles } from "../../self-healing-bot/src/index.js";
import { proposeSafePatches } from "../../self-healing-bot/src/llm-analyzer.js";
import { normalizeAppMetadata, normalizeHttpsUrl } from "../../../packages/shared-types/src/index.js";
import sodium from "libsodium-wrappers-sumo";

const API = "https://api.github.com";
const MAX_BODY = 12 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const ARTIFACT_EXTENSIONS = Object.freeze({
  android: new Set([".apk", ".aab"]),
  ios: new Set([".ipa"]),
  windows: new Set([".exe", ".msi", ".msix", ".zip"]),
  macos: new Set([".dmg", ".pkg", ".zip"]),
  web: new Set([".zip"])
});
const ARTIFACT_CONTENT_TYPES = Object.freeze({
  ".apk": "application/vnd.android.package-archive", ".aab": "application/octet-stream",
  ".ipa": "application/octet-stream", ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi", ".msix": "application/msix", ".zip": "application/zip",
  ".dmg": "application/x-apple-diskimage", ".pkg": "application/octet-stream"
});
export function isAllowedArtifactForPlatform(platform, filename) {
  const normalizedPlatform = String(platform || "").toLowerCase();
  const name = String(filename || "").split(/[\\/]/).pop().toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  return Boolean(ARTIFACT_EXTENSIONS[normalizedPlatform]?.has(ext));
}
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
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,CF-Access-JWT-Assertion,x-hendy-github-token");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) throw new Error("Request body exceeds 12 MiB.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) throw new Error("Request body exceeds 12 MiB.");
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
      // Android App Bundles are for store distribution, not direct package installation.
      if (metadata.platform === "android" && /\.aab$/i.test(String(metadata.filename || ""))) continue;
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
  const filename = String(body.filename || "").split(/[\\/]/).pop().replace(/[\\r\\n"]/g, "_");
  const platform = String(body.platform || "").toLowerCase();
  if (!ARTIFACT_EXTENSIONS[platform]) return json({ success: false, error: "unsupported_platform" }, 400);
  if (!isAllowedArtifactForPlatform(platform, filename)) return json({ success: false, error: "artifact_extension_does_not_match_platform" }, 400);
  const base64 = String(body.contentBase64 || "");
  if (!base64 || base64.length > Math.ceil(MAX_ARTIFACT_BYTES * 4 / 3) + 8) return json({ success: false, error: "artifact_too_large_or_empty" }, 413);
  let bytes;
  try { const raw = atob(base64.replace(/\s/g, "")); bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
  catch { return json({ success: false, error: "invalid_base64" }, 400); }
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) return json({ success: false, error: "artifact_limit_8_mib_use_matrix_build_or_r2_cli_for_large_files" }, 413);
  const id = crypto.randomUUID();
  const objectKey = `artifacts/${platform}/${id}/${filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = [...hash].map((b) => b.toString(16).padStart(2,"0")).join("");
  await env.RELEASES_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: ARTIFACT_CONTENT_TYPES["." + filename.split(".").pop().toLowerCase()] || "application/octet-stream" }, customMetadata: { sha256, platform, version: String(body.version || "0.0.0") } });
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
export const AUTOMATION_FIELDS = Object.freeze([
  { name: "CF_ACCESS_TEAM_DOMAIN", kind: "variable" },
  { name: "CF_ACCESS_AUD", kind: "variable" },
  { name: "CF_ACCESS_ADMIN_EMAILS", kind: "variable" },
  { name: "ALLOWED_ORIGINS", kind: "variable" },
  { name: "GITHUB_SYNC_TOKEN", kind: "secret" },
  { name: "LLM_API_KEY", kind: "secret" },
  { name: "AUTO_HEAL_ENABLED", kind: "variable" },
  { name: "SELF_HEAL_WEBHOOK_SECRET", kind: "secret" },
  { name: "DISCORD_WEBHOOK_URL", kind: "secret" },
  { name: "ANDROID_PACKAGE_NAME", kind: "variable" },
  { name: "ANDROID_KEYSTORE_BASE64", kind: "secret" },
  { name: "ANDROID_KEYSTORE_PASSWORD", kind: "secret" },
  { name: "ANDROID_KEY_ALIAS", kind: "variable" },
  { name: "ANDROID_KEY_PASSWORD", kind: "secret" },
  { name: "IOS_APP_IDENTIFIER", kind: "variable" },
  { name: "IOS_CERTIFICATE_P12_BASE64", kind: "secret" },
  { name: "IOS_CERTIFICATE_PASSWORD", kind: "secret" },
  { name: "IOS_PROVISION_PROFILE_BASE64", kind: "secret" },
  { name: "IOS_SIGNING_IDENTITY", kind: "variable" },
  { name: "MACOS_CERTIFICATE_P12_BASE64", kind: "secret" },
  { name: "MACOS_CERTIFICATE_PASSWORD", kind: "secret" },
  { name: "MACOS_SIGNING_IDENTITY", kind: "variable" },
  { name: "APPLE_ID", kind: "variable" },
  { name: "APPLE_TEAM_ID", kind: "variable" },
  { name: "WINDOWS_CERT_PFX_BASE64", kind: "secret" },
  { name: "WINDOWS_CERT_PASSWORD", kind: "secret" }
]);
const AUTOMATION_FIELD_MAP = new Map(AUTOMATION_FIELDS.map((field) => [field.name, field]));
const DERIVED_CALLBACK_VARIABLE = "BUILD_STATUS_WEBHOOK_URL";
const MAX_GITHUB_ACTION_VALUE_BYTES = 48000;

async function githubActionsRequest(token, env, endpoint, init = {}) {
  const owner = String(env.GITHUB_OWNER || "");
  const repo = String(env.GITHUB_REPO || "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("GitHub owner/repository is not configured correctly in the Worker.");
  }
  const response = await fetch(`${API}/repos/${owner}/${repo}/actions/${endpoint}`, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  if (text) { try { data = JSON.parse(text); } catch { data = {}; } }
  if (!response.ok) throw new Error(`GitHub Actions API request failed (HTTP ${response.status}). Check token scope and repository permissions.`);
  return data;
}
function automationStatusPayload(secretNames, variableNames, statusAvailable = true) {
  const secrets = new Set(secretNames);
  const variables = new Set(variableNames);
  return {
    success: true,
    statusAvailable,
    requiresToken: !statusAvailable,
    statuses: AUTOMATION_FIELDS.map((field) => ({
      name: field.name,
      kind: field.kind,
      configured: field.kind === "secret" ? secrets.has(field.name) : variables.has(field.name)
    })),
    callbackUrlConfigured: variables.has(DERIVED_CALLBACK_VARIABLE)
  };
}
async function getAutomationStatus(token, env) {
  if (!token) return automationStatusPayload([], [], false);
  const [secretData, variableData] = await Promise.all([
    githubActionsRequest(token, env, "secrets?per_page=100"),
    githubActionsRequest(token, env, "variables?per_page=100")
  ]);
  return automationStatusPayload(
    (secretData.secrets || []).map((item) => item.name),
    (variableData.variables || []).map((item) => item.name),
    true
  );
}
export function normalizeAutomationValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Values must be a JSON object.");
  const unknown = Object.keys(values).filter((name) => !AUTOMATION_FIELD_MAP.has(name));
  if (unknown.length) throw new Error("Unsupported configuration field: " + unknown.slice(0, 3).join(", "));
  const normalized = {};
  for (const [name, input] of Object.entries(values)) {
    if (typeof input !== "string") throw new Error(name + " must be a string.");
    if (input.trim() === "") continue;
    if (input.includes("\u0000")) throw new Error(name + " contains an invalid NUL character.");
    let value = input;
    if (name === "AUTO_HEAL_ENABLED" && value !== "true" && value !== "false") throw new Error("AUTO_HEAL_ENABLED must be true or false.");
    if (name.endsWith("_BASE64")) {
      value = value.replace(/\s+/g, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error(name + " must contain valid Base64.");
      }
    }
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > MAX_GITHUB_ACTION_VALUE_BYTES) {
      throw new Error(name + " exceeds GitHub's 48 KiB value limit. Use a smaller certificate or store large binary files in R2.");
    }
    normalized[name] = value;
  }
  return normalized;
}
async function updateAutomationValues(inputValues, env, { deployAfterSync = false } = {}) {
  const values = normalizeAutomationValues(inputValues);
  const token = String(values.GITHUB_SYNC_TOKEN || env.GITHUB_SYNC_TOKEN || "").trim();
  if (!token) throw new Error("Enter GITHUB_SYNC_TOKEN or configure it as a Worker secret before syncing GitHub Actions values.");
  const entries = Object.entries(values);
  if (!entries.length) throw new Error("No values were provided. Empty fields are deliberately skipped to avoid overwriting existing settings.");
  const variableEntries = entries.filter(([name]) => AUTOMATION_FIELD_MAP.get(name).kind === "variable");
  const secretEntries = entries.filter(([name]) => AUTOMATION_FIELD_MAP.get(name).kind === "secret");
  let publicKey = null;
  let sodiumReady = false;
  if (secretEntries.length) {
    publicKey = await githubActionsRequest(token, env, "secrets/public-key");
    if (!publicKey?.key || !publicKey?.key_id) throw new Error("GitHub did not return the repository Actions public key.");
    await sodium.ready;
    sodiumReady = true;
  }
  const existingVariables = variableEntries.length
    ? await githubActionsRequest(token, env, "variables?per_page=100")
    : { variables: [] };
  const existingVariableNames = new Set((existingVariables.variables || []).map((item) => item.name));
  const updated = [];
  const skipped = AUTOMATION_FIELDS.map((field) => field.name).filter((name) => !Object.prototype.hasOwnProperty.call(values, name));

  for (const [name, value] of secretEntries) {
    if (!sodiumReady) await sodium.ready;
    const keyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    const encrypted = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
    const encryptedValue = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
    await githubActionsRequest(token, env, "secrets/" + encodeURIComponent(name), {
      method: "PUT",
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKey.key_id })
    });
    updated.push(name);
  }
  for (const [name, value] of variableEntries) {
    const existing = existingVariableNames.has(name);
    await githubActionsRequest(token, env, existing ? "variables/" + encodeURIComponent(name) : "variables", {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify(existing ? { value } : { name, value })
    });
    updated.push(name);
  }
  let deployment = { requested: false, triggered: false };
  if (deployAfterSync) {
    deployment.requested = true;
    try {
      await githubActionsRequest(token, env, "workflows/deploy-cloudflare.yml/dispatches", {
        method: "POST",
        body: JSON.stringify({ ref: String(env.GITHUB_BRANCH || "main") })
      });
      deployment.triggered = true;
      deployment.actionsUrl = `https://github.com/${String(env.GITHUB_OWNER || "")}/${String(env.GITHUB_REPO || "")}/actions`;
    } catch {
      deployment.error = "Settings were synced, but GitHub could not dispatch deploy-cloudflare.yml. Verify Actions: write permission and required Cloudflare credentials.";
    }
  }
  const status = await getAutomationStatus(token, env);
  return {
    ...status,
    updated,
    skipped,
    deployment,
    note: "GitHub secret values were sealed with the repository public key. Secret values are never returned."
  };
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
    const seen = new Set(builds.flatMap((item) => [item.id, item.runId].filter((value) => value !== undefined && value !== null && value !== "").map(String)));
    for (const item of result.results || []) {
      const identifiers = [item.id, item.runId].filter((value) => value !== undefined && value !== null && value !== "").map(String);
      if (!identifiers.some((value) => seen.has(value))) builds.push(item);
      identifiers.forEach((value) => seen.add(value));
    }
  }
  builds.sort((a,b) => String(b.createdAt || b.startedAt || "").localeCompare(String(a.createdAt || a.startedAt || "")));
  return builds.slice(0, 25);
}

export function normalizeScreenshotUrls(input) {
  if (input == null || input === "") return [];
  if (!Array.isArray(input)) throw new Error("Screenshots must be an array of HTTPS URLs.");
  if (input.length > 8) throw new Error("A maximum of eight screenshots is allowed per application.");
  const urls = input.map((item) => normalizeHttpsUrl(typeof item === "string" ? item : item?.url, "Screenshot URL", 1000)).filter(Boolean);
  return [...new Set(urls)];
}
async function attachScreenshots(apps, env) {
  if (!Array.isArray(apps) || apps.length === 0) return [];
  if (!env.DB) return apps.map((app) => ({ ...app, screenshots: [] }));
  const ids = [...new Set(apps.map((app) => String(app.id || "")).filter(Boolean))];
  if (!ids.length) return apps.map((app) => ({ ...app, screenshots: [] }));
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await env.DB.prepare(`SELECT app_id AS appId, image_url AS url, caption, position FROM app_screenshots WHERE app_id IN (${placeholders}) ORDER BY app_id, position ASC`).bind(...ids).all();
  const grouped = new Map();
  for (const row of rows.results || []) {
    if (!grouped.has(row.appId)) grouped.set(row.appId, []);
    grouped.get(row.appId).push({ url: row.url, caption: row.caption || "", position: Number(row.position || 0) });
  }
  return apps.map((app) => ({ ...app, screenshots: grouped.get(String(app.id)) || [] }));
}
async function saveApp(body, auth, env) {
  if (!env.DB) throw new Error("D1 database binding is missing.");
  const app = normalizeAppMetadata(body);
  const replaceScreenshots = Array.isArray(body.screenshots);
  const screenshots = replaceScreenshots ? normalizeScreenshotUrls(body.screenshots) : null;
  const now = new Date().toISOString();
  const current = await env.DB.prepare("SELECT id, created_at FROM apps WHERE id = ? OR slug = ? LIMIT 1").bind(app.id, app.slug).first();
  if (current?.id && !body.id) app.id = current.id;
  await env.DB.prepare("INSERT INTO apps (id, slug, name, description, category, icon_url, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, description=excluded.description, category=excluded.category, icon_url=excluded.icon_url, visibility=excluded.visibility, updated_at=excluded.updated_at")
    .bind(app.id, app.slug, app.name, app.description, app.category, app.iconUrl, app.visibility, current?.created_at || now, now).run();

  if (replaceScreenshots) {
    await env.DB.prepare("DELETE FROM app_screenshots WHERE app_id = ?").bind(app.id).run();
    for (let position = 0; position < screenshots.length; position++) {
      await env.DB.prepare("INSERT INTO app_screenshots (id, app_id, image_url, caption, position, created_at) VALUES (?, ?, ?, '', ?, ?)")
        .bind(crypto.randomUUID(), app.id, screenshots[position], position, now).run();
    }
  }

  const enriched = (await attachScreenshots([{ ...app, createdAt: current?.created_at || now, updatedAt: now }], env))[0];
  return { ...enriched, updatedBy: auth.email };
}
async function listPublicApps(env) {
  if (!env.DB) return json({ success: true, apps: [], storageReady: false });
  const result = await env.DB.prepare("SELECT id, slug, name, description, category, icon_url AS iconUrl, visibility, created_at AS createdAt, updated_at AS updatedAt FROM apps WHERE visibility='public' ORDER BY updated_at DESC LIMIT 500").all();
  const apps = await attachScreenshots(result.results || [], env);
  return json({ success: true, apps, storageReady: true });
}
async function listAdminReleases(env) {
  if (!env.RELEASES_BUCKET) return json({ success: true, releases: [], storageReady: false });
  const releases = [];
  let cursor;
  let pages = 0;
  do {
    const page = await env.RELEASES_BUCKET.list({ prefix: "catalog/", limit: 500, cursor });
    for (const object of page.objects || []) {
      const metadata = await readCatalogObject(env.RELEASES_BUCKET, object.key);
      if (metadata && metadata.id) releases.push(metadata);
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
  } while (cursor && pages < 5);
  releases.sort((a,b) => String(b.uploadedAt || b.publishedAt || "").localeCompare(String(a.uploadedAt || a.publishedAt || "")));
  return json({ success: true, releases: releases.slice(0, 100), storageReady: true, truncated: !!cursor });
}
async function listApps(env) {
  if (!env.DB) return json({ success: false, error: "d1_not_configured", apps: [] }, 503);
  const result = await env.DB.prepare("SELECT id, slug, name, description, category, icon_url AS iconUrl, visibility, created_at AS createdAt, updated_at AS updatedAt FROM apps ORDER BY updated_at DESC LIMIT 500").all();
  const apps = await attachScreenshots(result.results || [], env);
  return json({ success: true, apps });
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
  const value = String(path || "").replace(/\\/g, "/");
  const allowedRoot = ["apps/", "workers/", "packages/", "scripts/"].some((root) => value.startsWith(root));
  const sourceExtension = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".sql"].some((ext) => value.toLowerCase().endsWith(ext));
  const forbiddenSegment = value.split("/").some((segment) => [".github", "node_modules", "dist", "coverage"].includes(segment.toLowerCase()));
  return allowedRoot && sourceExtension && !forbiddenSegment;
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
async function extractGithubZipLogs(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const readU16 = (offset) => view.getUint16(offset, true);
  const readU32 = (offset) => view.getUint32(offset, true);
  if (bytes.length < 22) throw new Error("GitHub job log body is too small to be a ZIP archive.");
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (readU32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("GitHub job log body is not a ZIP archive.");
  const entryCount = readU16(eocd + 10);
  let central = readU32(eocd + 16);
  const chunks = [];
  let total = 0;
  for (let n = 0; n < entryCount && n < 200; n++) {
    if (central + 46 > bytes.length || readU32(central) !== 0x02014b50) break;
    const method = readU16(central + 10);
    const compressedSize = readU32(central + 20);
    const uncompressedSize = readU32(central + 24);
    const nameLength = readU16(central + 28);
    const extraLength = readU16(central + 30);
    const commentLength = readU16(central + 32);
    const localOffset = readU32(central + 42);
    const name = new TextDecoder().decode(bytes.slice(central + 46, central + 46 + nameLength));
    central += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || compressedSize > 2 * 1024 * 1024 || uncompressedSize > 4 * 1024 * 1024) continue;
    if (localOffset + 30 > bytes.length || readU32(localOffset) !== 0x04034b50) continue;
    const localNameLength = readU16(localOffset + 26);
    const localExtraLength = readU16(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) continue;
    const payload = bytes.slice(dataOffset, dataOffset + compressedSize);
    let decoded;
    if (method === 0) decoded = payload;
    else if (method === 8) {
      try {
        const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        decoded = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch { continue; }
    } else continue;
    if (decoded.length > 0) {
      const text = new TextDecoder().decode(decoded);
      chunks.push("FILE " + name + "\\n" + redactBuildLogs(text));
      total += text.length;
      if (total >= 24000) break;
    }
  }
  if (!chunks.length) throw new Error("ZIP archive had no readable log entries.");
  return chunks.join("\\n\\n").slice(-24000);
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
      const body = await response.arrayBuffer();
      let text;
      try {
        text = await extractGithubZipLogs(body);
      } catch {
        text = new TextDecoder().decode(body).slice(-9000);
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
    if (request.method === "GET" && path === "/api/admin/github/automation-secrets") {
      try {
        const suppliedToken = String(request.headers.get("x-hendy-github-token") || "").trim();
        return json(await getAutomationStatus(suppliedToken || env.GITHUB_SYNC_TOKEN || "", env));
      } catch (error) {
        return json({ success: false, error: error.message, statusAvailable: false }, 502);
      }
    }
    if (request.method === "POST" && path === "/api/admin/github/automation-secrets") {
      try {
        const body = await readJson(request);
        return json(await updateAutomationValues(body.values, env, { deployAfterSync: body.deployAfterSync === true }), 200);
      } catch (error) {
        return json({ success: false, error: String(error?.message || "GitHub automation sync failed.").slice(0, 600) }, 400);
      }
    }
    if (request.method === "GET" && path === "/api/admin/builds") return json({ success: true, builds: await getBuildStatus(env) });
    if (request.method === "GET" && path === "/api/admin/releases") return listAdminReleases(env);
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
    if (request.method === "POST" && path === "/api/releases/upload") {
      try { return await uploadRelease(await readJson(request), env, auth); }
      catch (error) { return json({ success: false, error: String(error?.message || "Artifact upload failed.").slice(0, 500) }, 400); }
    }
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
