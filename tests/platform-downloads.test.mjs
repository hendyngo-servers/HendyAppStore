import test from "node:test";
import assert from "node:assert/strict";
import { renderPlatformDownloadActions } from "../apps/web-user/src/components/PlatformDownloadActions.js";
import { renderIOSOtaDownloader } from "../apps/web-user/src/components/IOSOtaDownloader.js";
import { safeHref } from "../apps/web-user/src/shared/ui.js";
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
  const html = renderIOSOtaDownloader({ id: "release-42", platform: "ios", filename: "app.ipa", downloadUrl: "https://example.test/app.ipa" }, "https://api.example.test/api");
  assert.ok(html.includes("itms-services://?action=download-manifest"), "iOS OTA URL should use the install manifest scheme");
  assert.match(html, /ios-manifest/);
});

test("rejects dangerous download URL schemes", () => {
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(safeHref("//evil.example/file.exe"), "");
  assert.equal(safeHref("https://example.test/app.exe"), "https://example.test/app.exe");
  assert.equal(safeHref("/api/download?key=abc"), "/api/download?key=abc");
});
