import test from "node:test";
import assert from "node:assert/strict";
import { validateSyncPath } from "../workers/backend-api/src/github-sync.js";

test("allows project source paths", () => {
  assert.equal(validateSyncPath("apps/web-admin/src/app.js"), "apps/web-admin/src/app.js");
  assert.equal(validateSyncPath("workers/backend-api/src/index.js"), "workers/backend-api/src/index.js");
  assert.equal(validateSyncPath("package.json"), "package.json");
});

test("blocks traversal, secrets and workflow edits", () => {
  for (const path of ["../escape.js", "/absolute.js", "apps/.env", "workers/secret.pem", ".github/workflows/matrix-build.yml", "apps/node_modules/pkg/index.js"]) {
    assert.throws(() => validateSyncPath(path), undefined, path);
  }
});
