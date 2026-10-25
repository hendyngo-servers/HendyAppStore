import test from "node:test";
import assert from "node:assert/strict";
import { verifyAdminRequest, extractSpkiFromCertificate } from "../workers/backend-api/src/access.js";

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

test("extracts SubjectPublicKeyInfo from an X.509 DER certificate", () => {
  const tlv = (tag, body) => {
    if (body.length >= 128) throw new Error("test helper only supports short DER lengths");
    return Uint8Array.from([tag, body.length, ...body]);
  };
  const seq = (...parts) => tlv(0x30, Uint8Array.from(parts.flatMap((p) => [...p])));
  const integer = tlv(0x02, Uint8Array.from([1]));
  const version = tlv(0xa0, tlv(0x02, Uint8Array.from([2])));
  const bitString = tlv(0x03, Uint8Array.from([0, 0]));
  const spki = seq(seq(), bitString);
  const tbs = seq(version, integer, seq(), seq(), seq(), seq(), spki);
  const cert = seq(tbs, seq(), bitString);
  assert.deepEqual([...extractSpkiFromCertificate(cert)], [...spki]);
});

test("rejects malformed X.509 certificate payloads", () => {
  assert.throws(() => extractSpkiFromCertificate("not-a-certificate"));
  assert.throws(() => extractSpkiFromCertificate(new Uint8Array([0x30, 0x82, 0xff])));
});
