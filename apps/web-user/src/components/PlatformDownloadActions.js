import { escapeHtml, safeHref } from "../shared/ui.js";
import { renderAndroidDirectLink } from "./AndroidDirectLink.js";
import { renderWindowsSafeInstaller } from "./WindowsSafeInstaller.js";
import { renderMacOsDmgDownloader } from "./MacOsDmgDownloader.js";
import { renderIOSOtaDownloader } from "./IOSOtaDownloader.js";

export function renderPlatformDownloadActions(release, apiBase = "/api") {
  const platform = String(release?.platform || "").toLowerCase();
  switch (platform) {
    case "android": return renderAndroidDirectLink(release);
    case "windows": return renderWindowsSafeInstaller(release);
    case "macos": return renderMacOsDmgDownloader(release);
    case "ios": return renderIOSOtaDownloader(release, apiBase);
    default: {
      const href = safeHref(release?.downloadUrl);
      return href
        ? `<a class="button primary" href="${escapeHtml(href)}" rel="noopener noreferrer">Tải xuống ↗</a>`
        : '<span class="disabled-note">Chưa có artifact</span>';
    }
  }
}
