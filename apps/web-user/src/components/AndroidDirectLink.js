import { escapeHtml } from "../../../../packages/ui-components/src/index.js";
export function renderAndroidDirectLink(release) {
  if (!release?.downloadUrl) return '<span class="disabled-note">Chưa có APK</span>';
  return `<a class="button primary" href="${escapeHtml(release.downloadUrl)}" download rel="noopener noreferrer">Tải APK ↗</a>`;
}
