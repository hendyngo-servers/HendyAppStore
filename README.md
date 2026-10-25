# Hendy App Store — Cloudflare-first source-to-release platform

A fresh implementation of the Hendy architecture: adaptive public storefront, protected Admin Studio, Cloudflare edge routing, source/configuration analysis, GitHub synchronization, R2 release storage, and multi-OS GitHub Actions builds.

## Repository map

- `apps/web-user/`: Public storefront with adaptive mobile and desktop layouts.
- `apps/web-admin/`: Admin Studio with code paste, directory upload, virtual file tree, diagnostics, safe repair, and GitHub sync.
- `workers/edge-router/`: Routes public assets, protected Admin UI, and API traffic.
- `workers/backend-api/`: Cloudflare Access JWT verification, analysis, release listing, R2 artifact uploads, and GitHub commit integration.
- `workers/self-healing-bot/`: Deterministic allow-listed repairs and build diagnostics. It never executes uploaded code or silently changes arbitrary dependency versions.
- `.github/workflows/matrix-build.yml`: Windows, Android/Linux, and iOS/macOS build matrix. Native builds run only when their real platform project exists.
- `.github/workflows/deploy-cloudflare.yml`: Cloudflare-only deployment. No Render deployment configuration remains.

## Local development

Requires Node.js 22 or later.

```bash
npm install
npm run validate
npm test
npm run build
npm run heal:check
npm run dev
```

Open `http://127.0.0.1:4173` for the local public UI. Local preview does not emulate Cloudflare Access or the backend API.

## GitHub Actions configuration

Set in **GitHub → Settings → Secrets and variables → Actions**:

| Name | Type | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Scoped token for Workers, Pages, R2 |
| `CLOUDFLARE_ACCOUNT_ID` | Variable or Secret | Cloudflare account ID |
| `CF_ACCESS_TEAM_DOMAIN` | Variable or Secret | Access team hostname, e.g. `team-name.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Variable or Secret | Comma-separated AUD tags for every Access application protecting Admin UI/API routes |
| `CF_ACCESS_ADMIN_EMAILS` | Variable or Secret | Comma-separated allow-list of administrator emails |
| `GITHUB_SYNC_TOKEN` | Secret | Fine-grained GitHub token with Contents: Read/Write for this repository |
| `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD` | Optional Secrets | Authenticode PFX and password |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Optional Secrets | Android signing credentials |
| `IOS_CERTIFICATE_P12_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISION_PROFILE_BASE64`, `IOS_SIGNING_IDENTITY` | Optional Secrets | iOS signing assets |

Configure the GitHub **`cloudflare-production`** environment with required reviewers before adding deployment secrets. Configure **`release-signing`** with required reviewers and environment-scoped signing secrets. Build jobs do not receive signing keys; signing jobs do not check out or execute source code. A manual matrix run with `publish_signed=true` signs only real build products and uploads only signature-verified artifacts to R2.

## Cloudflare setup and access policy

The deploy workflow provisions the R2 bucket `hendy-app-store-releases`, Pages project `hendy-app-store`, API Worker `hendy-app-store-api`, and Edge Router `hendy-app-store-edge`.

1. Enable a `workers.dev` subdomain in Cloudflare if the account does not already have one.
2. Create Cloudflare Access applications/policies on the Edge Router hostname for `/admin*`, `/web-admin/*`, and `/api/*`; allow only the approved admin emails. Put each application's AUD tag into `CF_ACCESS_AUD`, comma-separated. The Worker refuses Admin requests when Access is missing or invalid.
3. Optionally attach a custom admin hostname to the Edge Router and set Worker variable `ADMIN_HOSTNAMES` to that hostname. The public storefront is deployed separately at `https://hendy-app-store.pages.dev`.
4. If using a custom Pages domain, add it to the API Worker `ALLOWED_ORIGINS` variable.

The deployment workflow fails closed if Cloudflare account credentials or Access allow-list configuration is missing. Do not put account tokens, GitHub tokens, signing keys, or passwords in source files.

## Source intake and self-healing

The Admin Studio supports code paste, multi-file upload, recursive directory drop, and a virtual directory tree. The Backend API validates path traversal, limits file count/size, rejects credentials and private-key extensions, and never runs uploaded source. Safe repair normalizes JSON, enforces a Node.js engine range where relevant, normalizes line endings, and adds safe ignore rules. Dependency conflicts are reported rather than "fixed" by blindly upgrading packages.

GitHub source sync commits approved project paths via the Git Data API. It blocks workflow edits and credential files; a push starts the normal CI/matrix workflow.

## Matrix builds and signing

The matrix runs on `ubuntu-latest` (Android), `windows-latest` (Windows), and `macos-latest` (iOS). If a real native project is missing, it writes a diagnostic instead of fabricating an APK/EXE/IPA. On manual release, the protected signing environment signs a real build product where the needed platform project and credentials are present. Verified signed artifacts and SHA-256 catalog entries can be published to R2.

The backend upload endpoint calculates SHA-256 but does not claim to verify platform signatures. R2 object publication from the matrix is only done after platform signing tools successfully verify the artifact.
