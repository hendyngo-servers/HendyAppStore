import { escapeHtml, safeHref } from "../shared/ui.js";
export function renderIOSOtaDownloader(release, apiBase = "/api") {
  const href = safeHref(release?.downloadUrl);
  const extension = String(release?.filename || "").split(".").pop().toLowerCase();
  const rawManifest = release?.manifestUrl || `${apiBase}/releases/ios-manifest?id=${encodeURIComponent(release?.id || "")}`;
  const manifest = safeHref(rawManifest);
  if (!href || extension !== "ipa" || !manifest) return '<span class="disabled-note">Chưa có IPA hoặc manifest HTTPS hợp lệ</span>';
  return `<div class="platform-download"><a class="button primary" href="${escapeHtml(href)}" download rel="noopener noreferrer">Tải IPA ↗</a><a class="button secondary" href="itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}">Cài qua OTA (yêu cầu IPA ký và profile phù hợp)</a></div>`;
}
