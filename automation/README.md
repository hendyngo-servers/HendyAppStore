# Automation

This directory contains repository-side automation helpers for Cloudflare deployments.

## Security rules

- Cloudflare-managed edge/TLS certificates renew automatically; do not store private keys or attempt to upload certificates for Cloudflare-managed hostnames.
- R2 backup jobs must be explicitly configured with a bucket, retention policy, and scoped credentials. Never run destructive sync/delete operations as a default.
- Put all credentials in GitHub Actions Secrets or Cloudflare Worker secrets, never in this directory or committed files.
- The production deployment entry point is `.github/workflows/deploy.yml` (push to `main` or manual dispatch). It provisions resources and publishes the Pages app.
- The repository's `scripts/provision-cloudflare-resources.mjs` and `scripts/smoke-test.mjs` are the current resource-provisioning and post-deploy verification helpers.
