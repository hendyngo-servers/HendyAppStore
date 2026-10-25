# Hendy App Store — Cloudflare monorepo

Hendy App Store is a Cloudflare-first app storefront and source-to-release studio. It has separate Public Store and Access-gated Admin Studio frontends, an Edge Router, a Backend API, D1/KV/R2/Queues, a restricted source synchronizer, safe and optional LLM-assisted repair, cross-platform build jobs and store-upload workflows.

## Monorepo layout

- `apps/web-user/`: Adaptive public storefront; Edge/Browser OS detection; validated platform download actions for Android APK, Windows EXE/MSI/ZIP, macOS DMG/PKG/ZIP and iOS OTA manifests; D1-backed app icons and screenshots.
- `apps/web-admin/`: Code paste zone, optional Monaco Editor, multi-file/folder uploader, virtual file tree, D1 metadata form (HTTPS icon plus up to eight screenshots per app), GitHub Actions monitor, build queue request, R2 artifact draft intake, source analyzer and reviewed AI repair proposals.
- `packages/shared-types/`: Shared AppData, ReleaseData and BuildLog types.
- `packages/ui-components/`: Escaping, pill and bytes-format helpers shared by both UIs.
- `workers/edge-router/`: Public entry, Admin routing and Backend service binding.
- `workers/backend-api/`: Cloudflare Access JWT verification, D1 app/build records, KV release cache, R2 artifacts/catalog, GitHub Actions dispatch/status and optional LLM repair proposal routes.
- `workers/alert-notifier/`: HMAC-verified GitHub Actions callback, D1 build-history update and optional Discord notification.
- `workers/self-healing-bot/`: Deterministic safe repairs and optional LLM-proposed patches.
- `android/`, `windows/`, `ios/`, `macos/`: Native wrapper projects that point to the public HTTPS storefront.
- `.github/workflows/matrix-build.yml`: Native build matrix; isolated signing job; publish only verified, signed products to R2.
- `.github/workflows/store-release.yml`: Manual gated upload to Google Play or App Store Connect/TestFlight.
- `.github/workflows/deploy-cloudflare.yml`: Provision and deploy R2, Pages, D1, KV, Queues, API Worker, Alert Worker and Edge Router. No Render deployment code remains.

## Local checks

Requires Node.js 22+.

```bash
npm run validate
npm test
npm run build
npm run heal:check
npm run dev
```

Local preview on `http://127.0.0.1:4173` serves the frontends only; it does not emulate Cloudflare Access, the API Worker, R2, Queues or real store APIs.

## GitHub repository Secrets and Variables

Set these under **Settings → Secrets and variables → Actions**:

| Name | Type | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Workers, Pages, R2, D1, KV and Queues permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Variable or Secret | 32-hex Cloudflare account ID |
| `CF_ACCESS_TEAM_DOMAIN` | Variable or Secret | Access team host, e.g. `team-name.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Variable or Secret | Comma-separated AUD tags used by the Access applications |
| `CF_ACCESS_ADMIN_EMAILS` | Variable or Secret | Comma-separated Admin email allow-list |
| `GITHUB_SYNC_TOKEN` | Secret | Fine-grained token with repository Contents read/write and Actions read/write for build dispatch |
| `LLM_API_KEY` | Optional Secret | Enables AI repair proposals; omitted by default |
| `AUTO_HEAL_ENABLED` | Variable or Secret | Defaults to `false`; set to `true` to enable failure-triggered AI repair and reviewed source-only patches |
| `SELF_HEAL_WEBHOOK_SECRET` | Optional Secret | Shared HMAC secret between Alert Worker and Backend API for the internal self-healing callback |
| `BUILD_STATUS_WEBHOOK_SECRET` | Optional Secret | HMAC secret shared by the build-status callback and Alert Worker |
| `BUILD_STATUS_WEBHOOK_URL` | Optional Secret | Deployed Alert Worker URL ending in `/webhooks/github/build-status` |
| `DISCORD_WEBHOOK_URL` | Optional Secret | Discord build alerts |
| `ALLOWED_ORIGINS` | Variable | Comma-separated Pages/custom origins allowed by API CORS |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Optional Secrets | Android signing |
| `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD` | Optional Secrets | Authenticode signing |
| `IOS_CERTIFICATE_P12_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISION_PROFILE_BASE64`, `IOS_SIGNING_IDENTITY` | Optional Secrets | iOS signing |
| `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` | Optional Secrets | Developer ID signing and optional notarization |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Optional Secret in `store-release` | Google Play upload |
| `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, `ASC_API_PRIVATE_KEY_BASE64` | Optional Secrets in `store-release` | App Store Connect upload |
| `ANDROID_PACKAGE_NAME`, `IOS_APP_IDENTIFIER` | Variables | Developer-portal application identifiers |

Configure GitHub environments `cloudflare-production`, `release-signing`, and `store-release` with required reviewers before adding production credentials. For Cloudflare, grant only the resource permissions required by the workflow. Never put key material, access tokens, or service-account JSON into the repository.

## Cloudflare Access and routing

The provisioning workflow generates these endpoints on a `workers.dev` subdomain:
- Public storefront: `https://hendy-app-store.pages.dev`
- Edge/Admin entry: `https://hendy-app-store-edge.<workers-subdomain>.workers.dev/admin`
- Backend API: `https://hendy-app-store-api.<workers-subdomain>.workers.dev`
- Alerts: `https://hendy-app-store-alerts.<workers-subdomain>.workers.dev/webhooks/github/build-status`

After the first deploy, configure Cloudflare Zero Trust Access applications/policies for the Edge hostname and protect `/admin*`, `/web-admin/*`, and privileged `/api/*` paths. Allow only approved identities. The backend independently validates the Access JWT's RS256 signature, issuer, expiration, audience and email allow-list. Keep the Pages origin in `ALLOWED_ORIGINS`; add trusted custom domains there as needed.

## Source ingestion and self-healing

Admin uploads are treated as text data and are never executed by the API. The backend rejects path traversal, key/certificate/environment files, excessive file counts and oversized payloads. Source sync blocks `.github/workflows/` paths and credentials. Safe repair normalizes JSON/line endings and ignore rules. The optional LLM analyzer returns patches constrained to the uploaded source file list; Admin must review and explicitly apply a proposal before syncing it. Automatic LLM commits require `AUTO_HEAL_ENABLED=true` in Worker secrets and the route's explicit `apply` flag.

## Automatic build-failure self-healing

Automatic self-healing is disabled by default. To enable it, configure `LLM_API_KEY`, `GITHUB_SYNC_TOKEN`, and a strong `SELF_HEAL_WEBHOOK_SECRET`, then set `AUTO_HEAL_ENABLED=true`. The Alert Worker verifies the GitHub build callback, records the build status in D1, and invokes the Backend API over a service binding using an HMAC-signed payload. The Backend API fetches failed GitHub Actions job logs, redacts common credential patterns, reads only eligible source files changed by the failing commit, and requests a minimal LLM patch. It commits only safe source-code file changes; it never edits workflow/deployment files, dependency manifests, or tests. A successful patch push automatically triggers a fresh CI/matrix run. D1 records each attempt and caps automatic repair at three attempts per hour to avoid infinite repair loops. Missing LLM/GitHub credentials, unsafe/no-change patches, or a disabled flag prevent automatic commits.

## Build and release workflow

The matrix builds Android APK/AAB on Ubuntu, Windows EXE on Windows 2025, iOS IPA input on macOS, and a macOS DMG. Signing is separated from source build jobs. Only signature-verified products enter the `signed-build-*` artifacts and R2 public catalog. Android APK is the direct-install Store download; Android AAB stays as a Google Play release artifact and is not presented as an installable package. If a signing secret is missing, the job does not create a public catalog entry for an unsigned product. Admin's direct R2 upload is limited to 8 MiB and always creates a private draft; use the matrix/signing path for public releases and larger binaries.

To build, open **Actions → Hendy App Store — Multi-OS Build Matrix**, run it manually, and set `publish_signed=true` only after signing secrets and the `release-signing` environment are configured. For Google Play or App Store Connect/TestFlight, run **Publish Hendy App Store to Google Play / App Store Connect** and select the successful matrix run ID containing the signed artifact. Developer portals, package IDs, store metadata, entitlements, certificates and approvals must be valid; CI cannot bypass vendor review requirements.

The current native projects are launchers for the HTTPS storefront. They create genuine build artifacts when their toolchains are available, but they are not substitutes for a fully featured native app product or required developer-account configuration.


## App metadata and media

The Admin metadata form can save an HTTPS icon URL and up to eight HTTPS screenshot URLs per app. D1 stores screenshot records separately in `app_screenshots`; public app metadata responses include the validated media list. The Store uses the icon in the catalog card and shows screenshots in the app detail area. Insecure HTTP URLs, URL credentials, and non-HTTPS schemes are rejected. The Edge Router returns `X-Hendy-Client-OS` and `X-Hendy-Device-Class` headers; the browser repeats local detection (including iPadOS desktop-mode handling) to adapt the layout.

## Deployment status notes

The repository CI checks source structure, JavaScript syntax, unit/security-guard tests, and the public Pages bundle. A successful CI run does not mean Cloudflare is deployed: the deployment workflow requires the Cloudflare API token, account ID, Access team domain, AUD tags, and admin email allow-list. It fails closed before provisioning when any required setting is absent. Set those values under GitHub Actions Secrets/Variables and rerun **Deploy Hendy App Store to Cloudflare Workers and Pages**. The workflow currently expects Cloudflare Zero Trust Access applications/policies to be configured for the protected custom Edge/Admin hostname; the Worker validates the JWT and email allow-list independently.
