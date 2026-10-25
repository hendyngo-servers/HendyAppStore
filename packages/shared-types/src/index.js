export const PLATFORMS = Object.freeze(["android", "ios", "windows", "macos", "web"]);
export const BUILD_STATUSES = Object.freeze(["queued", "running", "success", "failed", "cancelled"]);
export function isPlatform(value) { return PLATFORMS.includes(String(value || "").toLowerCase()); }
export function isBuildStatus(value) { return BUILD_STATUSES.includes(String(value || "").toLowerCase()); }
export function slugify(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
export function normalizeAppMetadata(input = {}) {
  const name = String(input.name || input.appName || "").trim().slice(0, 120);
  if (!name) throw new Error("App name is required.");
  const visibility = input.visibility === "private" ? "private" : "public";
  return {
    id: String(input.id || crypto.randomUUID()),
    slug: slugify(input.slug || name),
    name,
    description: String(input.description || "").trim().slice(0, 2000),
    category: String(input.category || "Utilities").trim().slice(0, 80),
    iconUrl: String(input.iconUrl || "").slice(0, 500),
    visibility,
    updatedAt: new Date().toISOString()
  };
}
