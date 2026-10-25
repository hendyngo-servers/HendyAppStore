export function renderMobileLayout(apps, onOpen) {
  return apps.map((app) => `<article class="app-card mobile-card" data-name="${escapeHtml(app.name || "")}"><div class="app-icon">${escapeHtml((app.name || "H").slice(0, 1).toUpperCase())}</div><div class="app-info"><h3>${escapeHtml(app.name || "Ứng dụng")}</h3><p>${escapeHtml(app.description || "Bản phát hành được quản lý")}</p><small>${escapeHtml(app.platform || "Multi-platform")} · ${escapeHtml(app.version || "Chưa có phiên bản")}</small></div><button class="small-button" data-open="${escapeHtml(app.id || "")}">Chi tiết</button></article>`).join("");
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
