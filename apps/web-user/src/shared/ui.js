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
