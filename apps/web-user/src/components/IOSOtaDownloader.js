import { escapeHtml } from "../../../../packages/ui-components/src/index.js";
export function renderIOSOtaDownloader(release, apiBase = "/api") {
  if (!release?.downloadUrl) return '<span class="disabled-note">Chưa có IPA</span>';
  const manifest = release.manifestUrl || `${apiBase}/releases/ios-manifest?id=${encodeURIComponent(release.id || "")}`;
  return `<div class="platform-download"><a class="button primary" href="${escapeHtml(release.downloadUrl)}" download rel="noopener noreferrer">Tải IPA ↗</a><a class="button secondary" href="itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}">Cài qua OTA (nếu thiết bị và chứng chỉ phù hợp)</a></div>`;
}
