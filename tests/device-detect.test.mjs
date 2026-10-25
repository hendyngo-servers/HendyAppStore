import test from "node:test";
import assert from "node:assert/strict";
import { detectDevice, detectOperatingSystem } from "../apps/web-user/src/hooks/useDeviceDetect.js";

test("detects common desktop and mobile operating systems", () => {
  assert.equal(detectOperatingSystem("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(detectOperatingSystem("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile"), "android");
  assert.equal(detectOperatingSystem("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");
  assert.equal(detectOperatingSystem("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), "macos");
});
test("adapts layouts using viewport plus tablet detection", () => {
  const phone = detectDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 390);
  assert.equal(phone.os, "ios");
  assert.equal(phone.preferredPlatform, "ios");
  assert.equal(phone.isMobile, true);
  const desktop = detectDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 1440);
  assert.equal(desktop.os, "windows");
  assert.equal(desktop.isDesktop, true);
});
test("detects iPadOS when Safari reports desktop MacIntel user agent", () => {
  const device = detectDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", 820, "MacIntel", 5);
  assert.equal(device.os, "ios");
  assert.equal(device.isTablet, true);
});
