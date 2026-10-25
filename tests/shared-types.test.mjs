import test from "node:test";
import assert from "node:assert/strict";
import { isPlatform, isBuildStatus, normalizeAppMetadata, slugify } from "../packages/shared-types/src/index.js";

test("normalizes app metadata for D1 storage", () => {
  const app = normalizeAppMetadata({ name: "Hendy Tools Pro", description: "Toolbox", visibility: "public" });
  assert.equal(app.slug, "hendy-tools-pro");
  assert.equal(app.visibility, "public");
  assert.ok(app.id);
  assert.ok(app.updatedAt);
});
test("normalizes accented slugs and validates enumerations", () => {
  assert.equal(slugify("Ứng dụng Hendy"), "ung-dung-hendy");
  assert.equal(isPlatform("macos"), true);
  assert.equal(isPlatform("playstation"), false);
  assert.equal(isBuildStatus("failed"), true);
});
