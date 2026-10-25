import test from "node:test";
import assert from "node:assert/strict";
import { analyzeProjectFiles } from "../workers/self-healing-bot/src/index.js";

test("repairs a missing Node engine range and adds safe ignore rules", () => {
  const result = analyzeProjectFiles([{ path: "package.json", content: JSON.stringify({ name: "sample", scripts: { test: "node --test" } }) }], { repair: true });
  assert.equal(result.success, true);
  assert.ok(result.repairs.length >= 2);
  const pkg = JSON.parse(result.files.find((f) => f.path === "package.json").content);
  assert.equal(pkg.engines.node, ">=22");
  assert.ok(result.files.some((f) => f.path === ".gitignore" && f.content.includes("*.p12")));
});

test("rejects path traversal and credential files", () => {
  const result = analyzeProjectFiles([
    { path: "../outside.js", content: "console.log(1)" },
    { path: ".env", content: "TOKEN=not-a-real-secret" }
  ]);
  assert.equal(result.success, false);
  assert.ok(result.diagnostics.some((d) => d.code === "UNSAFE_PATH"));
  assert.ok(result.diagnostics.some((d) => d.code === "SENSITIVE_FILE"));
});

test("reports invalid package JSON instead of rewriting it", () => {
  const result = analyzeProjectFiles([{ path: "package.json", content: "{" }], { repair: true });
  assert.equal(result.success, false);
  assert.ok(result.diagnostics.some((d) => d.code === "INVALID_PACKAGE_JSON"));
});

test("normalizes CRLF as a deterministic repair", () => {
  const result = analyzeProjectFiles([{ path: "apps/web-user/a.js", content: "line1\r\nline2\r\n" }], { repair: true });
  assert.equal(result.files.find((f) => f.path.endsWith("a.js")).content, "line1\nline2\n");
});
