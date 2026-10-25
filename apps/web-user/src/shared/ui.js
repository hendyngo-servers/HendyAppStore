export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
export function pill(label, tone = "neutral") {
  const normalized = ["success","warning","danger","info","neutral"].includes(tone) ? tone : "neutral";
  return `<span class="hendy-pill hendy-pill--${normalized}">${escapeHtml(label)}</span>`;
}
export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  if (bytes < 1024**3) return `${(bytes/1024**2).toFixed(2)} MB`;
  return `${(bytes/1024**3).toFixed(2)} GB`;
}

export function safeHref(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /[\u0000-\u001f\u007f\\]/.test(raw) || raw.startsWith("//")) return "";
  if (raw.startsWith("/")) return raw;
  try {
    const base = globalThis.location?.origin || "https://hendy.invalid";
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "";
    return url.href;
  } catch { return ""; }
}
