import test from "node:test";
import assert from "node:assert/strict";
import { renderPlatformDownloadActions } from "../apps/web-user/src/components/PlatformDownloadActions.js";
import { renderIOSOtaDownloader } from "../apps/web-user/src/components/IOSOtaDownloader.js";
import { renderWindowsSafeInstaller } from "../apps/web-user/src/components/WindowsSafeInstaller.js";

test("renders Android and Windows links only when an artifact exists", () => {
  const android = renderPlatformDownloadActions({ platform: "android", filename: "app.apk", downloadUrl: "https://example.test/app.apk" });
  assert.match(android, /Tải APK/);
  assert.match(android, /rel="noopener noreferrer"/);
  assert.match(renderPlatformDownloadActions({ platform: "android" }), /Chưa có APK/);
  assert.match(renderWindowsSafeInstaller({ platform: "windows", filename: "setup.exe", downloadUrl: "https://example.test/setup.exe" }), /Tải Windows/);
  assert.match(renderWindowsSafeInstaller({ platform: "windows", filename: "setup.zip.exe.exe", downloadUrl: "https://example.test/setup.exe" }), /Tải Windows/);
});
test("rejects an unsupported Windows download extension", () => {
  assert.match(renderWindowsSafeInstaller({ filename: "setup.sh", downloadUrl: "https://example.test/setup.sh" }), /không hợp lệ/);
});
test("iOS OTA action points to the generated manifest endpoint", () => {
  const html = renderIOSOtaDownloader({ id: "release-42", platform: "ios", downloadUrl: "https://example.test/app.ipa" }, "https://api.example.test/api");
  assert.match(html, /itms-services://\?action=download-manifest/);
  assert.match(html, /ios-manifest/);
});
