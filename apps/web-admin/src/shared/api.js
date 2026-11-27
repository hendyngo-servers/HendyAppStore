const API_PREFIX = "/api";

export function resolveAdminApiUrl(path) {
  const raw = String(path ?? "").trim();
  if (!raw) throw new TypeError("Admin API path is required.");
  let url;
  try {
    url = new URL(raw, "https://hendy-admin.invalid");
  } catch {
    throw new TypeError("Admin API path is invalid.");
  }
  if (url.origin !== "https://hendy-admin.invalid" || url.username || url.password || url.hash) {
    throw new TypeError("Admin API requests must use the same-origin Edge Router.");
  }
  if (url.pathname !== API_PREFIX && !url.pathname.startsWith(API_PREFIX + "/")) {
    throw new TypeError("Admin API paths must begin with /api.");
  }
  return url.pathname + url.search;
}
