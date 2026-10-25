let keyCache = null;
let keyCacheUntil = 0;

function decodePart(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodePart(value)));
}
function normalizeTeam(value) {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
async function getJwks(team) {
  if (keyCache && Date.now() < keyCacheUntil && keyCache.team === team) return keyCache.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Unable to load Cloudflare Access signing keys.");
  const payload = await response.json();
  const keys = payload.keys || payload.public_certs || [];
  if (!Array.isArray(keys) || !keys.length) throw new Error("Cloudflare Access returned no signing keys.");
  keyCache = { team, keys }; keyCacheUntil = Date.now() + 5 * 60 * 1000;
  return keys;
}
export async function verifyAdminRequest(request, env) {
  const team = normalizeTeam(env.CF_ACCESS_TEAM_DOMAIN);
  const allowedAudiences = String(env.CF_ACCESS_AUD || "").split(",").map((x) => x.trim()).filter(Boolean);
  const allowedEmails = String(env.CF_ACCESS_ADMIN_EMAILS || env.ADMIN_EMAILS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!team || !allowedAudiences.length || !allowedEmails.length) return { ok: false, status: 503, error: "admin_access_not_configured" };
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401, error: "cloudflare_access_jwt_required" };
  try {
    const segments = token.split(".");
    if (segments.length !== 3) throw new Error("Malformed JWT.");
    const header = decodeJson(segments[0]);
    const claims = decodeJson(segments[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unsupported JWT algorithm.");
    const keys = await getJwks(team);
    const key = keys.find((item) => item.kid === header.kid && item.kty === "RSA" && item.n && item.e);
    if (!key) throw new Error("Signing key is unknown.");
    const publicKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, decodePart(segments[2]), new TextEncoder().encode(segments[0] + "." + segments[1]));
    if (!valid) throw new Error("JWT signature is invalid.");
    if (claims.iss !== "https://" + team) throw new Error("JWT issuer mismatch.");
    const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!tokenAudiences.some((aud) => allowedAudiences.includes(aud))) throw new Error("JWT audience mismatch.");
    if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("JWT has expired.");
    const email = String(claims.email || "").toLowerCase();
    if (!email || !allowedEmails.includes(email)) return { ok: false, status: 403, error: "admin_email_not_allowed" };
    return { ok: true, email, subject: claims.sub || "" };
  } catch (error) {
    return { ok: false, status: 401, error: "invalid_cloudflare_access_jwt", detail: error instanceof Error ? error.message : "JWT validation failed." };
  }
}
