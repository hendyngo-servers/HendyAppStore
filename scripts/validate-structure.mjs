import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const required = [
  "apps/web-user/index.html", "apps/web-user/src/app.js", "apps/web-user/src/hooks/useDeviceDetect.js",
  "apps/web-user/src/layouts/MobileAppStoreLayout.js", "apps/web-user/src/layouts/DesktopPortalLayout.js",
  "apps/web-admin/index.html", "apps/web-admin/src/main.js", "apps/web-admin/src/hooks/useVirtualFileTree.js",
  "apps/web-admin/src/components/CodePasteZone.js", "apps/web-admin/src/components/FileUploadZone.js",
  "apps/web-admin/src/components/FileTreeVisualizer.js", "apps/web-admin/src/layouts/MobileCMSPocketLayout.js",
  "apps/web-admin/src/layouts/FullDevStudioLayout.js", "workers/edge-router/src/index.js",
  "workers/backend-api/src/index.js", "workers/backend-api/src/access.js", "workers/backend-api/src/github-sync.js",
  "workers/self-healing-bot/src/index.js", ".github/workflows/matrix-build.yml",
  ".github/workflows/deploy-cloudflare.yml", "wrangler.toml"
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
for (const runner of ["ubuntu-latest", "windows-latest", "macos-latest"]) assert.ok(matrix.includes(runner), "Matrix runner missing: " + runner);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const sourceFiles = ["apps", "workers", "scripts", "tests"].flatMap(walk).filter((path) => /\.(?:js|mjs|cjs)$/.test(path));
for (const path of sourceFiles) {
  try { execFileSync(process.execPath, ["--check", path], { stdio: "pipe" }); }
  catch (error) {
    const output = Buffer.concat([error.stdout || Buffer.alloc(0), error.stderr || Buffer.alloc(0)]).toString("utf8");
    throw new Error(`JavaScript syntax check failed for ${path}:\n${output}`);
  }
}
console.log(`Architecture valid: ${required.length} required paths, legacy source removed, Cloudflare bindings present, ${sourceFiles.length} JavaScript files parse.`);
