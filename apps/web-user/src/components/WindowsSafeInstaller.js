import { escapeHtml, safeHref } from "../shared/ui.js";
export function renderWindowsSafeInstaller(release) {
  const href = safeHref(release?.downloadUrl);
  const ext = String(release?.filename || "").split(".").pop().toLowerCase();
  if (!href) return '<span class="disabled-note">Chưa có trình cài đặt Windows</span>';
  if (!["exe", "msi", "msix", "zip"].includes(ext)) return '<span class="disabled-note">Định dạng Windows không hợp lệ</span>';
  return `<a class="button primary" href="${escapeHtml(href)}" download rel="noopener noreferrer">Tải Windows .${escapeHtml(ext)} ↗</a>`;
}
