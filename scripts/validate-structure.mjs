import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const required = [
  "functions/_middleware.js", "functions/_lib/backend.js", "functions/api/auth.js", "functions/api/sync-logs.js", "functions/api/[[path]].js",
  "packages/db-schema/package.json", "packages/db-schema/migrations/0001_initial.sql", "packages/db-schema/validate.mjs",
  "apps/web-user/index.html", "apps/web-user/src/app.js", "apps/web-user/src/components/PlatformDownloadActions.js",
  "apps/web-user/src/components/IOSOtaDownloader.js", "apps/web-user/src/components/MacOsDmgDownloader.js",
  "apps/web-user/src/components/AndroidDirectLink.js", "apps/web-user/src/components/WindowsSafeInstaller.js",
  "apps/web-user/src/hooks/useDeviceDetect.js", "apps/web-user/src/layouts/MobileAppStoreLayout.js",
  "apps/web-user/src/layouts/DesktopPortalLayout.js",
  "apps/web-admin/index.html", "apps/web-admin/src/main.js", "apps/web-admin/src/app.js",
  "apps/web-admin/src/providers/AuthProvider.js", "apps/web-admin/src/hooks/useVirtualFileTree.js",
  "apps/web-admin/src/components/CodePasteZone.js", "apps/web-admin/src/components/FileUploadZone.js",
  "apps/web-admin/src/components/FileTreeVisualizer.js", "apps/web-admin/src/components/BuildStatusMonitor.js",
  "apps/web-admin/src/components/StoreMetadataForm.js", "apps/web-admin/src/components/ArtifactDraftForm.js",
  "apps/web-admin/src/components/AutomationSecretsForm.tsx", "apps/web-admin/src/components/CertUploadSecure.tsx",
  "apps/web-admin/src/automation-entry.tsx", "scripts/build-admin-react.mjs", "scripts/sync-github-variable.mjs", "tests/automation-secrets.test.mjs",
  "apps/web-admin/src/layouts/MobileCMSPocketLayout.js",
  "apps/web-admin/src/layouts/FullDevStudioLayout.js",
  "packages/shared-types/src/index.js", "packages/shared-types/src/index.d.ts", "packages/ui-components/src/index.js",
  "docs/DEPLOY-CLOUDFLARE.md", "workers/edge-router/src/index.js", "workers/edge-router/wrangler.toml", "workers/backend-api/src/index.js", "workers/backend-api/src/access.js",
  "workers/backend-api/src/github-sync.js", "workers/backend-api/src/db/schema.sql",
  "workers/self-healing-bot/src/index.js", "workers/self-healing-bot/src/llm-analyzer.js",
  "workers/alert-notifier/src/index.js", "scripts/provision-cloudflare-resources.mjs",
  "scripts/render-cloudflare-config.mjs", "scripts/prepare-pages.mjs", "scripts/smoke-test.mjs", ".github/workflows/matrix-build.yml",
  ".github/workflows/deploy.yml", ".github/workflows/deploy-cloudflare.yml", ".github/workflows/store-release.yml",
  ".github/workflows/build-status-callback.yml", "wrangler.toml",
  "android/settings.gradle", "android/app/src/main/AndroidManifest.xml",
  "windows/HendyAppStore.csproj", "ios/HendyAppStore.xcodeproj/project.pbxproj",
  "macos/HendyAppStoreMac.xcodeproj/project.pbxproj"
];
const missing = required.filter((path) => !existsSync(path));
assert.deepEqual(missing, [], "Required architecture files are missing: " + missing.join(", "));
for (const path of [".github/workflows/deploy-render.yml", "server.ts", "src/App.tsx", "public/index.html"]) {
  assert.equal(existsSync(path), false, `Legacy source should not exist after rewrite: ${path}`);
}
const rootManifest = JSON.parse(readFileSync("package.json", "utf8"));
assert.ok(rootManifest.workspaces?.includes("apps/web-user") && rootManifest.workspaces?.includes("apps/web-admin"), "Root npm workspaces must include both UI packages.");
assert.ok(rootManifest.workspaces?.includes("packages/shared-types") && rootManifest.workspaces?.includes("packages/db-schema"), "Root npm workspaces must include shared types and D1 schema.");
const deployEntry = readFileSync(".github/workflows/deploy.yml", "utf8");
assert.match(deployEntry, /push:/);
assert.match(deployEntry, /npx wrangler pages deploy/);
assert.match(deployEntry, /--functions functions/, "The main deployment workflow must bundle Pages Functions.");
assert.match(deployEntry, /HENDY_API_BASE_URL/);
const pagesMiddleware = readFileSync("functions/_middleware.js", "utf8");
assert.match(pagesMiddleware, /api\/admin\/status/);
assert.match(pagesMiddleware, /context\.next\(new Request\(rewritten, request\)\)/);
const root = readFileSync("wrangler.toml", "utf8");
assert.match(root, /name = "hendyappstore"/, "Root config must match the Cloudflare Workers Builds worker name.");
assert.match(root, /STATIC_ASSETS/);
assert.doesNotMatch(root, /^service\s*=\s*"hendy-app-store-api"\s*$/m,
  "Root Workers Builds config must not depend on the API Worker being provisioned first.");
assert.match(root, /not_found_handling = "none"/, "Worker assets must leave unmatched route handling to the router.");
assert.ok(root.includes('run_worker_first = ["/api*", "/admin*", "/web-admin", "/web-admin/*"]'),
  "Admin/API paths must run through the Worker before matching static files are served.");
const productionEdge = readFileSync("workers/edge-router/wrangler.toml", "utf8");
assert.match(productionEdge, /name = "hendy-app-store-edge"/);
assert.match(productionEdge, /service = "hendy-app-store-api"/, "Integrated router must bind the API Worker after API deployment.");
assert.ok(productionEdge.includes('run_worker_first = ["/api*", "/admin*", "/web-admin", "/web-admin/*"]'),
  "Integrated router must auth-gate both the Admin root path and Admin assets.");
assert.match(productionEdge, /directory = "\.\.\/\.\.\/apps"/, "Production router must upload the app assets.");
const deployWorkflow = readFileSync(".github/workflows/deploy-cloudflare.yml", "utf8");
assert.match(deployWorkflow, /Verify Cloudflare API token/);
assert.match(deployWorkflow, /--dry-run/, "Cloudflare Worker bundles should be validated before remote deployment.");
assert.match(deployWorkflow, /Public Store with Admin locked/, "The workflow should keep Admin fail-closed when Access is not configured.");
const apiConfig = readFileSync("workers/backend-api/wrangler.toml", "utf8");
for (const binding of ["RELEASES_BUCKET", "DB", "CONFIG_CACHE", "BUILD_QUEUE"]) assert.ok(apiConfig.includes(binding), "Backend binding missing: " + binding);
const matrix = readFileSync(".github/workflows/matrix-build.yml", "utf8");
for (const runner of ["ubuntu-latest", "windows-2025", "macos-latest"]) assert.ok(matrix.includes(runner), "Matrix runner missing: " + runner);
assert.ok(matrix.includes("detect-targets") && matrix.includes("fromJson(needs.detect-targets.outputs.matrix)"), "Dynamic target matrix is missing.");
assert.equal(/render[.]com/i.test(matrix), false, "Render deployment must remain removed.");
const schemaMigration = readFileSync("packages/db-schema/migrations/0001_initial.sql", "utf8").trim();
const runtimeSchema = readFileSync("workers/backend-api/src/db/schema.sql", "utf8").trim();
assert.equal(schemaMigration, runtimeSchema, "D1 migration and runtime schema must stay in sync.");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
for (const dependency of ["libsodium-wrappers-sumo", "react", "react-dom"]) assert.ok(manifest.dependencies?.[dependency], "Root dependency missing: " + dependency);
assert.ok(manifest.devDependencies?.esbuild, "esbuild is required to bundle the React Admin panels.");
assert.equal(manifest.devDependencies?.wrangler, "4.152.0", "Pin Wrangler so Cloudflare's build image does not silently install a different CLI version.");
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const sourceFiles = ["apps", "functions", "workers", "scripts", "tests", "packages", "automation"].flatMap(walk).filter((path) => /\.(?:js|mjs|cjs)$/.test(path));
for (const path of sourceFiles) {
  try { execFileSync(process.execPath, ["--check", path], { stdio: "pipe" }); }
  catch (error) {
    const output = Buffer.concat([error.stdout || Buffer.alloc(0), error.stderr || Buffer.alloc(0)]).toString("utf8");
    throw new Error(`JavaScript syntax check failed for ${path}:\n${output}`);
  }
}
console.log(`Architecture valid: ${required.length} required paths, legacy source removed, Cloudflare bindings present, ${sourceFiles.length} JavaScript files parse.`);
