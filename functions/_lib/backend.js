const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin"
  }
});

export function backendOrigin(env) {
  const value = String(env.HENDY_API_BASE_URL || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function unavailable() {
  return json({ success: false, error: "backend_not_configured" }, 503);
}

export async function proxyBackend(request, env, backendPath) {
  const origin = backendOrigin(env);
  if (!origin) return unavailable();
  const source = new URL(request.url);
  const target = new URL(backendPath, origin);
  target.search = source.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("origin");
  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;
  const response = await fetch(new Request(target, init));
  const resultHeaders = new Headers(response.headers);
  resultHeaders.set("cache-control", "no-store");
  resultHeaders.set("x-content-type-options", "nosniff");
  resultHeaders.set("referrer-policy", "same-origin");
  resultHeaders.delete("set-cookie");
  return new Response(response.body, { status: response.status, headers: resultHeaders });
}

export { json };
