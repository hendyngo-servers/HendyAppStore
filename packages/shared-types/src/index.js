export const PLATFORMS = Object.freeze(["android", "ios", "windows", "macos", "web"]);
export const BUILD_STATUSES = Object.freeze(["queued", "running", "success", "failed", "cancelled"]);
export function isPlatform(value) { return PLATFORMS.includes(String(value || "").toLowerCase()); }
export function isBuildStatus(value) { return BUILD_STATUSES.includes(String(value || "").toLowerCase()); }
export function slugify(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
export function normalizeHttpsUrl(value, label = "URL", maxLength = 1000) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} must be an absolute HTTPS URL.`); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error(`${label} must use HTTPS and must not include credentials.`);
  return url.href;
}
export function normalizeAppMetadata(input = {}) {
  const name = String(input.name || input.appName || "").trim().slice(0, 120);
  if (!name) throw new Error("App name is required.");
  const slug = slugify(input.slug || name);
  if (!slug) throw new Error("App slug must contain at least one letter or number.");
  const visibility = input.visibility === "private" ? "private" : "public";
  return {
    id: String(input.id || crypto.randomUUID()),
    slug,
    name,
    description: String(input.description || "").trim().slice(0, 2000),
    category: String(input.category || "Utilities").trim().slice(0, 80),
    iconUrl: normalizeHttpsUrl(input.iconUrl, "Icon URL", 500),
    visibility,
    updatedAt: new Date().toISOString()
  };
}
