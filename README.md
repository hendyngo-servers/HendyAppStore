# Hendy App Store

Hendy App Store combines a public software storefront, a separately gated Admin Control Center, and a Cloudflare edge API for release metadata and downloads.

## Architecture

- **Public Portal**: `index.html`, `src/App.tsx`, and `src/interface/store/StorefrontV2.tsx`.
- **Admin Console**: `admin.html` and `src/admin-main.tsx`. Admin routes must be protected by Cloudflare Access on the Worker; Pages upload intentionally omits `admin.html`.
- **Shared runtime/API**: `src/worker.ts`, `functions/api/[[path]].ts`, and `src/hendy-platform/shared/`.
- **Release storage**: Cloudflare R2 bucket binding `RELEASES_BUCKET`.
- **CI/CD**: GitHub Actions validate, test, build, deploy to Cloudflare Workers and Pages, and package the current web release.

The Cloudflare resource slugs remain `hendy-tool-releas` (Worker and Pages) and `hendy-tool-releases` (R2) so the already configured deployment URLs can be reused. Rename them only after updating Wrangler configs, provisioning scripts, workflow URLs, and the deployment-contract test together.

## Local development

Requires Node.js 22+ and npm.

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
node scripts/verify-store-admin-build.mjs
```

The production build must emit both `dist/index.html` and `dist/admin.html`. These are intentionally independent HTML entry points.

## Deploy to Cloudflare Workers and Pages

The workflow `.github/workflows/deploy-cloudflare.yml` provisions the Worker/R2/Pages runtime, links Cloudflare Access, deploys the Worker, deploys the public Pages storefront, and runs smoke tests. Trigger it by pushing to `main`, using **Actions → Deploy Hendy Store to Cloudflare Workers & Pages**, or the documented `repository_dispatch` hook.

In **GitHub → Settings → Secrets and variables → Actions**, configure:

| Name | Storage | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Scoped Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Variable or Secret | 32-character Cloudflare account ID |
| `CF_ACCESS_ADMIN_EMAILS` | Variable or Secret | Approved administrator emails, comma-separated |
| `RELEASE_PUBLISH_TOKEN` | Optional Secret | Stable CI publishing token; a temporary token may be generated if omitted |

Use least-privilege permissions for Workers Scripts, Pages, R2, and Cloudflare Zero Trust Access applications/policies/identity providers/groups. Never commit API tokens or secret values. Deployment fails closed when required credentials are missing.

Do not assume a URL is live until deployment succeeds. After deployment, check the Actions smoke-test summary and verify `/healthz` and `/api/v1/runtime/readiness` on the Worker.

## Release packaging

`.github/workflows/build-and-publish-release.yml` packages the current web app as a ZIP and calculates a SHA-256 checksum. No native Windows desktop or Flutter/Android project is present in this repository, so this workflow does **not** claim to generate genuine `.exe` or `.apk` binaries. Add those platform projects and build toolchains before enabling native packaging.

## Security

- Protect Admin HTML and privileged API routes with Cloudflare Access on the primary Worker.
- The public Pages build removes `dist/admin.html` and denies privileged admin/publisher endpoints.
- Store runtime secrets in GitHub Actions or Cloudflare secret storage, never in Git.
- `public/_headers` and `public/_redirects` define static security headers and fallback routing.
- Limit the Access allow-list to approved accounts and review policies periodically.
