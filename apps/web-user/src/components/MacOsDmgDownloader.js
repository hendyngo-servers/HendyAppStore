import { escapeHtml } from "../shared/ui.js";
export function renderMacOsDmgDownloader(release) {
  if (!release?.downloadUrl) return '<span class="disabled-note">Chưa có DMG</span>';
  const ext = String(release.filename || "").split(".").pop().toLowerCase();
  if (!["dmg","pkg","zip"].includes(ext)) return '<span class="disabled-note">Định dạng macOS không hợp lệ</span>';
  return `<a class="button primary" href="${escapeHtml(release.downloadUrl)}" download rel="noopener noreferrer">Tải macOS .${escapeHtml(ext)} ↗</a>`;
}
