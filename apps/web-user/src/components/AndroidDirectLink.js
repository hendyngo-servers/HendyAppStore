import { escapeHtml, safeHref } from "../shared/ui.js";
export function renderAndroidDirectLink(release) {
  const href = safeHref(release?.downloadUrl);
  const extension = String(release?.filename || "").split(".").pop().toLowerCase();
  if (extension === "aab") return '<span class="disabled-note">AAB chỉ dành cho phát hành qua Google Play; tải trực tiếp APK để cài đặt.</span>';
  if (!href || extension !== "apk") return '<span class="disabled-note">Chưa có APK hợp lệ</span>';
  return `<a class="button primary" href="${escapeHtml(href)}" download rel="noopener noreferrer">Tải APK ↗</a>`;
}
