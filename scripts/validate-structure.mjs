import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import assert from "node:assert/strict";

const required = [
  "apps/web-user/index.html",
  "apps/web-user/src/app.js",
  "apps/web-user/src/hooks/useDeviceDetect.js",
  "apps/web-user/src/layouts/MobileAppStoreLayout.js",
  "apps/web-user/src/layouts/DesktopPortalLayout.js",
  "apps/web-admin/index.html",
  "apps/web-admin/src/main.js",
  "apps/web-admin/src/hooks/useVirtualFileTree.js",
  "apps/web-admin/src/components/CodePasteZone.js",
  "apps/web-admin/src/components/FileUploadZone.js",
  "apps/web-admin/src/components/FileTreeVisualizer.js",
  "apps/web-admin/src/layouts/MobileCMSPocketLayout.js",
  "apps/web-admin/src/layouts/FullDevStudioLayout.js",
  "workers/edge-router/src/index.js",
  "workers/backend-api/src/index.js",
  "workers/backend-api/src/access.js",
  "workers/backend-api/src/github-sync.js",
  "workers/self-healing-bot/src/index.js",
  ".github/workflows/matrix-build.yml",
  ".github/workflows/deploy-cloudflare.yml",
  "wrangler.toml"
];
const missing = required.filter((path) => !existsSync(path));
assert.deepEqual(missing, [], "Required architecture files are missing: " + missing.join(", "));
for (const path of [".github/workflows/deploy-render.yml", "server.ts", "src/App.tsx", "public/index.html"]) {
  assert.equal(existsSync(path), false, `Legacy source should not exist after rewrite: ${path}`);
}
const root = readFileSync("wrangler.toml", "utf8");
assert.match(root, /STATIC_ASSETS/);
assert.match(root, /BACKEND_API/);
const matrix = readFileSync(".github/workflows/matrix-build.yml", "utf8");
for (const runner of ["ubuntu-latest","windows-latest","macos-latest"]) assert.ok(matrix.includes(runner), "Matrix runner missing: " + runner);
console.log(`Architecture structure valid: ${required.length} required paths, old application tree removed, Cloudflare Worker bindings present.`);
