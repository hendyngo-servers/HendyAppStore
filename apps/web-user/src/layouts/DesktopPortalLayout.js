export function renderDesktopLayout(apps) {
  return apps.map((app) => {
    const safe = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    return `<article class="app-card" data-name="${safe(app.name)}"><div class="app-icon">${safe((app.name || "H").slice(0,1).toUpperCase())}</div><div class="app-info"><div class="card-meta"><span>${safe(app.platform || "Application")}</span><span>${safe(app.version || "Release pending")}</span></div><h3>${safe(app.name || "Ứng dụng")}</h3><p>${safe(app.description || "Bản phát hành được quản lý")}</p><div class="card-bottom"><small>${safe(app.updatedAt || "Chưa có ngày phát hành")}</small><button class="small-button" data-open="${safe(app.id || "")}">Xem bản phát hành</button></div></div></article>`;
  }).join("");
}
