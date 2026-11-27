import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("root static website contains all required public entry points", () => {
  for (const path of ["index.html", "sitemap.xml", "subpage/index.html", "legal-notice/index.html", "privacy/index.html"]) {
    assert.ok(existsSync(path), "Missing static website path: " + path);
  }
  const home = read("index.html");
  for (const route of ["/subpage/", "/legal-notice/", "/privacy/", "/sitemap.xml"]) {
    assert.ok(home.includes(route), "Homepage does not link to " + route);
  }
  assert.ok(home.includes("/css/custom.261126163517.css"));
  assert.ok(home.includes("/js/custom.261126163157.js"));
  assert.ok(home.includes("/g/fonts.css"));
});

test("root homepage and Worker-served storefront source stay synchronized", () => {
  assert.equal(read("index.html"), read("apps/web-user/index.html"));
});

test("Pages CSP explicitly permits the font stylesheet and font files", () => {
  const headers = read("apps/web-user/_headers");
  assert.ok(headers.includes("https://fonts.googleapis.com"));
  assert.ok(headers.includes("https://fonts.gstatic.com"));
});

test("PHP compatibility bridge is constrained and excluded from Cloudflare assets", () => {
  const php = read("api.php");
  assert.ok(php.includes("HENDY_API_BASE_URL"));
  assert.ok(php.includes("'health'") && php.includes("'apps'") && php.includes("'releases'"));
  assert.ok(php.includes("CURLOPT_FOLLOWLOCATION => false"));
  const sync = read("scripts/sync-static-site-assets.mjs");
  assert.ok(!sync.includes('"api.php"'), "PHP source must never be copied into the Worker asset tree");
  assert.ok(read("workers/edge-router/src/index.js").includes('path === "/api.php"'));
});

test("flag assets are generated reproducibly from the pinned package", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.dependencies?.["flag-icons"], "7.6.0");
  const sync = read("scripts/sync-static-site-assets.mjs");
  assert.ok(sync.includes('flagPackage + "/flags/1x1"'));
  assert.ok(sync.includes('flagPackage + "/flags/4x3"'));
  assert.ok(sync.includes("flag-icons.min.css"));
});

test("reserved directories explain source assets not present in the repository", () => {
  for (const path of [
    "g/static/s/roboto/v51/README.md",
    "g/static/s/opensans/v44/README.md",
    "images/README.md",
    "webcard/static/README.md",
    "webcard/vendor/slick/README.md",
    "website/.gitkeep"
  ]) assert.ok(existsSync(path), "Missing asset documentation: " + path);
});

test("sitemap template includes every public content route", () => {
  const sitemap = read("sitemap.xml");
  for (const route of ["/", "/subpage/", "/legal-notice/", "/privacy/", "/dich-vu/"]) {
    assert.ok(sitemap.includes(route), "Sitemap is missing " + route);
  }
});
