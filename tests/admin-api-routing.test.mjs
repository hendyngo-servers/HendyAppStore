import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdminApiUrl } from "../apps/web-admin/src/shared/api.js";

test("Admin API requests stay on the same-origin Edge Router route", () => {
  assert.equal(resolveAdminApiUrl("/api/admin/status"), "/api/admin/status");
  assert.equal(resolveAdminApiUrl("/api/runtime/readiness?detail=1"), "/api/runtime/readiness?detail=1");
  assert.equal(resolveAdminApiUrl("/api"), "/api");
});

test("Admin API resolver rejects backend host bypass and non-API routes", () => {
  assert.throws(() => resolveAdminApiUrl("https://api.example.workers.dev/api/admin/status"), /same-origin Edge Router/);
  assert.throws(() => resolveAdminApiUrl("/admin"), /begin with \/api/);
  assert.throws(() => resolveAdminApiUrl("/api/../../admin"), /begin with \/api/);
});
