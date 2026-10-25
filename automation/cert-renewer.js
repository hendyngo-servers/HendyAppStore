/**
 * Certificate expiry audit helper. It never creates or rotates production secrets.
 * Run through a secure scheduler with certificate metadata obtained from the secret manager.
 */
export function daysUntilExpiry(notAfter, now = new Date()) {
  const expiry = new Date(notAfter);
  if (!Number.isFinite(expiry.getTime())) throw new Error("Certificate expiry must be a valid date.");
  return Math.floor((expiry.getTime() - now.getTime()) / 86400000);
}
export function auditCertificates(certificates, { warnDays = 30, now = new Date() } = {}) {
  return certificates.map((item) => {
    const days = daysUntilExpiry(item.notAfter, now);
    return { name: String(item.name || "certificate"), daysUntilExpiry: days, status: days < 0 ? "expired" : days <= warnDays ? "expiring" : "valid" };
  });
}
