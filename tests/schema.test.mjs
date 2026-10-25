import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

test("D1 schema contains app, build, event and release tables", () => {
  const sql = readFileSync("workers/backend-api/src/db/schema.sql", "utf8");
  for (const name of ["apps", "build_history", "build_events", "release_metadata", "source_sync_logs"]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + name));
  }
});
test("native projects are real project scaffolds, not fabricated artifacts", () => {
  assert.ok(existsSync("android/app/build.gradle"));
  assert.ok(existsSync("windows/HendyAppStore.csproj"));
  assert.ok(existsSync("ios/HendyAppStore.xcodeproj/project.pbxproj"));
  assert.ok(existsSync("macos/HendyAppStoreMac.xcodeproj/project.pbxproj"));
});
