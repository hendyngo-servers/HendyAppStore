import { escapeHtml, safeHref } from "../shared/ui.js";

export function renderMobileLayout(apps) {
  return apps.map((app) => {
    const iconUrl = safeHref(app.iconUrl || "");
    const icon = iconUrl.startsWith("https://")
      ? `<img class="app-icon-image" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : escapeHtml((app.name || "H").slice(0, 1).toUpperCase());
    return `<article class="app-card mobile-card" data-name="${escapeHtml(app.name || "")}"><div class="app-icon">${icon}</div><div class="app-info"><h3>${escapeHtml(app.name || "Ứng dụng")}</h3><p>${escapeHtml(app.description || "Bản phát hành được quản lý")}</p><small>${escapeHtml(app.platform || "Multi-platform")} · ${escapeHtml(app.version || "Chưa có phiên bản")}</small></div><button class="small-button" data-open="${escapeHtml(app.id || "")}">Chi tiết</button></article>`;
  }).join("");
}
