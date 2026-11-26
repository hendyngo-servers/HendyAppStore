import test from "node:test";
import assert from "node:assert/strict";
import bot, {
  buildMainKeyboard,
  escapeHtml,
  filterApps,
  filterReleases,
  safeHttpsUrl
} from "../workers/telegram-bot/src/index.js";

test("main keyboard is compact and contains only real App Store workflows", () => {
  const markup = buildMainKeyboard();
  assert.equal(markup.resize_keyboard, true);
  assert.equal(markup.is_persistent, true);
  const labels = markup.keyboard.flat().map((item) => item.text);
  assert.deepEqual(labels, [
    "🛍 Kho ứng dụng", "🔎 Tìm ứng dụng",
    "📦 Bản phát hành", "📲 Tải theo nền tảng",
    "🌐 Mở Hendy Store", "❔ Trợ giúp"
  ]);
  assert.equal("storeUrl" in markup, false);
});

test("HTML escaping protects Telegram HTML messages", () => {
  assert.equal(escapeHtml("<script a=\"b\">&'</script>"), "&lt;script a=&quot;b&quot;&gt;&amp;&#39;&lt;/script&gt;");
});

test("HTTPS URL guard rejects insecure, credentialed and malformed URLs", () => {
  assert.equal(safeHttpsUrl("https://store.example/app"), "https://store.example/app");
  assert.equal(safeHttpsUrl("http://store.example"), "");
  assert.equal(safeHttpsUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpsUrl("https://user:pass@store.example"), "");
  assert.equal(safeHttpsUrl("not a url"), "");
});

test("app search matches name, slug, description and category without case sensitivity", () => {
  const apps = [
    { name: "Hendy Tools", slug: "hendy-tools", description: "Utilities", category: "Tools" },
    { name: "Photo Lab", slug: "photo-lab", description: "Image editor", category: "Design" }
  ];
  assert.deepEqual(filterApps(apps, "HENDY"), [apps[0]]);
  assert.deepEqual(filterApps(apps, "image"), [apps[1]]);
  assert.deepEqual(filterApps(apps, "design"), [apps[1]]);
  assert.equal(filterApps(apps, "").length, 2);
});

test("release filters use exact platform and search available metadata", () => {
  const releases = [
    { appName: "Hendy Client", version: "2.0.0", platform: "android", filename: "client.apk" },
    { appName: "Hendy Client", version: "2.0.0", platform: "windows", filename: "client.exe" },
    { appName: "Photo Lab", version: "1.3.0", platform: "android", filename: "photo.apk" }
  ];
  assert.deepEqual(filterReleases(releases, "android").map((item) => item.filename), ["client.apk", "photo.apk"]);
  assert.deepEqual(filterReleases(releases, "windows", "client").map((item) => item.filename), ["client.exe"]);
  assert.deepEqual(filterReleases(releases, "ios"), []);
});

test("health endpoint is readable without exposing configuration values", async () => {
  const response = await bot.fetch(new Request("https://bot.example/healthz"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, "hendy-app-store-telegram-bot");
  assert.equal(body.status, "not_configured");
  assert.equal("token" in body, false);
  assert.equal("secret" in body, false);
});

test("Telegram webhook rejects missing or incorrect secret header", async () => {
  const request = new Request("https://bot.example/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 1 })
  });
  const response = await bot.fetch(request, {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "expected-secret"
  });
  assert.equal(response.status, 401);
});

test("Telegram webhook rejects oversized updates before parsing", async () => {
  const request = new Request("https://bot.example/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "expected-secret"
    },
    body: "x".repeat(256 * 1024 + 1)
  });
  const response = await bot.fetch(request, {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "expected-secret"
  });
  assert.equal(response.status, 413);
});
