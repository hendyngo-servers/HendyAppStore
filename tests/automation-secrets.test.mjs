import test from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_FIELDS } from "../workers/backend-api/src/index.js";

test("automation form schema tracks exactly 26 unique GitHub Secrets and Variables", () => {
  assert.equal(AUTOMATION_FIELDS.length, 26);
  const names = AUTOMATION_FIELDS.map((field) => field.name);
  assert.equal(new Set(names).size, 26);
  for (const field of AUTOMATION_FIELDS) {
    assert.match(field.name, /^[A-Z][A-Z0-9_]+$/);
    assert.ok(["secret", "variable"].includes(field.kind));
  }
});

test("certificate/private-key material is classified as GitHub Secret, not Variable", () => {
  const byName = new Map(AUTOMATION_FIELDS.map((field) => [field.name, field.kind]));
  for (const name of [
    "GITHUB_SYNC_TOKEN", "LLM_API_KEY", "ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_PASSWORD", "IOS_CERTIFICATE_P12_BASE64", "IOS_CERTIFICATE_PASSWORD",
    "IOS_PROVISION_PROFILE_BASE64", "MACOS_CERTIFICATE_P12_BASE64", "MACOS_CERTIFICATE_PASSWORD",
    "APPLE_APP_SPECIFIC_PASSWORD", "WINDOWS_CERT_PFX_BASE64", "WINDOWS_CERT_PASSWORD"
  ]) assert.equal(byName.get(name), "secret", name + " must be stored as a GitHub Actions Secret");
  for (const name of [
    "CF_ACCESS_AUD", "CF_ACCESS_ADMIN_EMAILS", "ALLOWED_ORIGINS", "AUTO_HEAL_ENABLED",
    "ANDROID_PACKAGE_NAME", "ANDROID_KEY_ALIAS", "IOS_APP_IDENTIFIER", "IOS_SIGNING_IDENTITY",
    "MACOS_SIGNING_IDENTITY", "APPLE_ID", "APPLE_TEAM_ID"
  ]) assert.equal(byName.get(name), "variable", name + " must be stored as a GitHub Actions Variable");
});

test("build callback URL is derived separately and not counted as a user-entered credential", () => {
  assert.equal(AUTOMATION_FIELDS.some((field) => field.name === "BUILD_STATUS_WEBHOOK_URL"), false);
});
