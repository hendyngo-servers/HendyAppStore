import { escapeHtml } from "../../../../packages/ui-components/src/index.js";
export function renderWindowsSafeInstaller(release) {
  if (!release?.downloadUrl) return '<span class="disabled-note">Chưa có trình cài đặt Windows</span>';
  const ext = String(release.filename || "").split(".").pop().toLowerCase();
  if (!["exe","msi","msix","zip"].includes(ext)) return '<span class="disabled-note">Định dạng Windows không hợp lệ</span>';
  return `<a class="button primary" href="${escapeHtml(release.downloadUrl)}" download rel="noopener noreferrer">Tải Windows .${escapeHtml(ext)} ↗</a>`;
}
