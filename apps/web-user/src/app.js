import { detectDevice } from "./hooks/useDeviceDetect.js";
import { renderMobileLayout } from "./layouts/MobileAppStoreLayout.js";
import { renderDesktopLayout } from "./layouts/DesktopPortalLayout.js";
import { renderPlatformDownloadActions } from "./components/PlatformDownloadActions.js";

const API_BASE = (globalThis.HENDY_CONFIG?.apiBaseUrl || "/api").replace(/\/$/, "");
const $ = (selector) => document.querySelector(selector);
let releases = [];
$("#year").textContent = String(new Date().getFullYear());
const initialDevice = detectDevice();
const osLabels = { ios: "iPhone/iPad", android: "Android", windows: "Windows PC", macos: "macOS", chromeos: "ChromeOS", linux: "Linux", unknown: "thiết bị của bạn", web: "trình duyệt" };
const recommendation = $("#device-recommendation");
if (recommendation) recommendation.textContent = `Đã nhận diện: ${osLabels[initialDevice.os] || osLabels.web} · ${initialDevice.isMobile ? "giao diện di động" : initialDevice.isTablet ? "giao diện máy tính bảng" : "giao diện máy tính"}.`;

const adminLink = $(".admin-link");
if (adminLink && globalThis.HENDY_CONFIG?.adminUrl) adminLink.href = globalThis.HENDY_CONFIG.adminUrl;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function normalizeRelease(r) {
  return { id: String(r.id || r.key || ""), name: String(r.appName || r.name || r.product || "Hendy App"), description: String(r.description || r.notes || "Bản phát hành được quản lý"), version: String(r.version || "—"), platform: String(r.platform || "Multi-platform"), updatedAt: r.publishedAt || r.createdAt || r.updatedAt || "", downloadUrl: r.downloadUrl || r.url || "", filename: String(r.filename || ""), manifestUrl: r.manifestUrl || "", sha256: r.sha256 || r.checksum || "" };
}
function showStatus(text, ok = true) {
  const el = $("#api-status"); el.textContent = text; el.classList.toggle("error", !ok);
}
function renderCatalog(list = releases) {
  const root = $("#catalog-grid");
  const unique = [...new Map(list.map((r) => [r.name, r])).values()];
  const { isMobile } = detectDevice();
  root.innerHTML = unique.length ? (isMobile ? renderMobileLayout(unique) : renderDesktopLayout(unique)) : '<article class="empty-state"><strong>Chưa có bản phát hành</strong><p>Danh mục sẽ xuất hiện sau khi Admin phát hành artifact đầu tiên.</p></article>';
  root.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => {
    const item = list.find((r) => r.id === button.dataset.open) || list.find((r) => r.name === button.closest(".app-card")?.querySelector("h3")?.textContent);
    if (item) showRelease(item);
  }));
}
function showRelease(item) {
  $("#release-list").innerHTML = `<article class="release-card"><div><span class="release-platform">${escapeHtml(item.platform)}</span><h3>${escapeHtml(item.name)} <small>${escapeHtml(item.version)}</small></h3><p>${escapeHtml(item.description)}</p><small>${item.sha256 ? "SHA-256: " + escapeHtml(item.sha256) : "Checksum chưa được công bố"}</small></div><div class="release-actions">${renderPlatformDownloadActions(item, API_BASE)}</div></article>`;
  $("#releases").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderReleases() {
  const root = $("#release-list");
  root.innerHTML = releases.length ? releases.slice(0, 8).map((r) => `<article class="release-row"><div class="release-badge">${escapeHtml(r.platform.slice(0,3).toUpperCase())}</div><div class="release-summary"><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(r.version)} · ${escapeHtml(r.platform)}</span></div><div class="release-end"><span>${escapeHtml(r.updatedAt || "Ngày phát hành chưa có")}</span>${r.downloadUrl ? renderPlatformDownloadActions(r, API_BASE) : '<span class="disabled-note">Đang chuẩn bị</span>'}</div></article>`).join("") : '<article class="empty-state">Chưa có bản phát hành công khai.</article>';
}
async function loadReleases() {
  const [releaseResult, appResult] = await Promise.allSettled([
    fetch(`${API_BASE}/releases`, { headers: { Accept: "application/json" } }),
    fetch(`${API_BASE}/apps`, { headers: { Accept: "application/json" } })
  ]);
  const items = [];
  let connected = false;
  try {
    if (releaseResult.status === "fulfilled" && releaseResult.value.ok) {
      const payload = await releaseResult.value.json();
      items.push(...(Array.isArray(payload.releases) ? payload.releases : []).map(normalizeRelease));
      connected = true;
    }
  } catch (error) { console.warn("Release catalog could not be parsed:", error.message); }
  try {
    if (appResult.status === "fulfilled" && appResult.value.ok) {
      const payload = await appResult.value.json();
      const apps = (Array.isArray(payload.apps) ? payload.apps : []).map((app) => normalizeRelease({
        ...app, appName: app.name, platform: "web", version: "Metadata", filename: "", downloadUrl: "",
        description: app.description || "Ứng dụng được quản lý trong Hendy Store"
      }));
      items.push(...apps);
      connected = true;
    }
  } catch (error) { console.warn("App metadata could not be parsed:", error.message); }
  releases = items;
  showStatus(connected ? "API đã kết nối" : "Chưa kết nối được API", connected);
  renderCatalog(); renderReleases();
}
$("#search").addEventListener("input", (event) => {
  const term = event.target.value.trim().toLocaleLowerCase();
  renderCatalog(releases.filter((r) => [r.name, r.description, r.platform].join(" ").toLocaleLowerCase().includes(term)));
});
window.addEventListener("resize", () => renderCatalog());
loadReleases();
