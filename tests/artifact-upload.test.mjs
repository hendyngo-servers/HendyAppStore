import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedArtifactForPlatform, normalizeScreenshotUrls } from "../workers/backend-api/src/index.js";

test("artifact extensions must match their publishing platform", () => {
  assert.equal(isAllowedArtifactForPlatform("android", "client.apk"), true);
  assert.equal(isAllowedArtifactForPlatform("android", "bundle.aab"), true);
  assert.equal(isAllowedArtifactForPlatform("ios", "app.ipa"), true);
  assert.equal(isAllowedArtifactForPlatform("windows", "setup.exe"), true);
  assert.equal(isAllowedArtifactForPlatform("windows", "setup.msi"), true);
  assert.equal(isAllowedArtifactForPlatform("macos", "setup.dmg"), true);
  assert.equal(isAllowedArtifactForPlatform("web", "web-bundle.zip"), true);
});
test("rejects cross-platform extensions and direct iOS plist uploads", () => {
  assert.equal(isAllowedArtifactForPlatform("android", "setup.exe"), false);
  assert.equal(isAllowedArtifactForPlatform("ios", "app.apk"), false);
  assert.equal(isAllowedArtifactForPlatform("ios", "manifest.plist"), false);
  assert.equal(isAllowedArtifactForPlatform("windows", "setup.sh"), false);
  assert.equal(isAllowedArtifactForPlatform("other", "app.apk"), false);
});

test("accepts a bounded set of HTTPS screenshots and rejects insecure URLs", () => {
  assert.deepEqual(normalizeScreenshotUrls(["https://cdn.example.test/1.png", "https://cdn.example.test/2.png"]), [
    "https://cdn.example.test/1.png",
    "https://cdn.example.test/2.png"
  ]);
  assert.throws(() => normalizeScreenshotUrls(["http://cdn.example.test/1.png"]), /HTTPS/);
  assert.throws(() => normalizeScreenshotUrls(["javascript:alert(1)"]), /HTTPS/);
  assert.throws(() => normalizeScreenshotUrls(Array.from({ length: 9 }, (_, i) => `https://cdn.example.test/${i}.png`)), /eight screenshots/);
});
