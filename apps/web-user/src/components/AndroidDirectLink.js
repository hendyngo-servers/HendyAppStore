import { escapeHtml, safeHref } from "../shared/ui.js";
export function renderAndroidDirectLink(release) {
  const href = safeHref(release?.downloadUrl);
  const extension = String(release?.filename || "").split(".").pop().toLowerCase();
  if (!href || !["apk", "aab"].includes(extension)) return '<span class="disabled-note">Chưa có APK/AAB hợp lệ</span>';
  return `<a class="button primary" href="${escapeHtml(href)}" download rel="noopener noreferrer">Tải ${extension.toUpperCase()} ↗</a>`;
}
