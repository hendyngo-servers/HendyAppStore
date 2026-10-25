import { escapeHtml, safeHref } from "../shared/ui.js";

export function renderDesktopLayout(apps) {
  return apps.map((app) => {
    const safe = escapeHtml;
    const iconUrl = safeHref(app.iconUrl || "");
    const icon = iconUrl.startsWith("https://")
      ? `<img class="app-icon-image" src="${safe(iconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : safe((app.name || "H").slice(0, 1).toUpperCase());
    return `<article class="app-card" data-name="${safe(app.name)}"><div class="app-icon">${icon}</div><div class="app-info"><div class="card-meta"><span>${safe(app.platform || "Application")}</span><span>${safe(app.version || "Release pending")}</span></div><h3>${safe(app.name || "Ứng dụng")}</h3><p>${safe(app.description || "Bản phát hành được quản lý")}</p><div class="card-bottom"><small>${safe(app.updatedAt || "Chưa có ngày phát hành")}</small><button class="small-button" data-open="${safe(app.id || "")}">Xem bản phát hành</button></div></div></article>`;
  }).join("");
}
