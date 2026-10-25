import test from "node:test";
import assert from "node:assert/strict";
import { verifyAdminRequest } from "../workers/backend-api/src/access.js";

test("fails closed when Cloudflare Access is not configured", async () => {
  const result = await verifyAdminRequest(new Request("https://api.example.test/api/admin/status"), {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.error, "admin_access_not_configured");
});

test("requires Cloudflare Access JWT when configuration exists", async () => {
  const result = await verifyAdminRequest(new Request("https://api.example.test/api/admin/status"), {
    CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", CF_ACCESS_AUD: "audience", CF_ACCESS_ADMIN_EMAILS: "admin@example.com"
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, "cloudflare_access_jwt_required");
});
