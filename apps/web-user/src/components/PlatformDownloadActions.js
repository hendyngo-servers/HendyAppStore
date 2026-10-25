import { renderAndroidDirectLink } from "./AndroidDirectLink.js";
import { renderWindowsSafeInstaller } from "./WindowsSafeInstaller.js";
import { renderMacOsDmgDownloader } from "./MacOsDmgDownloader.js";
import { renderIOSOtaDownloader } from "./IOSOtaDownloader.js";
export function renderPlatformDownloadActions(release, apiBase = "/api") {
  switch (String(release?.platform || "").toLowerCase()) {
    case "android": return renderAndroidDirectLink(release);
    case "windows": return renderWindowsSafeInstaller(release);
    case "macos": return renderMacOsDmgDownloader(release);
    case "ios": return renderIOSOtaDownloader(release, apiBase);
    default: return release?.downloadUrl ? `<a class="button primary" href="${String(release.downloadUrl).replace(/["<>]/g, "")}" rel="noopener noreferrer">Tải xuống ↗</a>` : '<span class="disabled-note">Chưa có artifact</span>';
  }
}
