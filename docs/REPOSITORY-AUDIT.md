# Repository audit and consolidation

## Baseline
This audit is based on the merged `main` tree at commit `dce2e86db1eb04eb8474cebde7814c730bf02211`.

## Duplicate-looking files reviewed
- `apps/web-user/src/App.js` is a compatibility/export facade; `src/main.js` starts the DOM application in `src/app.js`. They have different roles and are retained.
- `apps/web-admin/src/App.js` is likewise a public export facade; `src/main.js` mounts the Admin Studio from `src/app.js`. They are not duplicate implementations.
- `functions/api/auth.js` and `functions/api/sync-logs.js` are narrow same-origin aliases; the catch-all Pages Function forwards other API paths. They share the proxy helper and are retained for compatibility.
- `workers/edge-router` and `functions/_middleware.js` both enforce Admin access in different deployment topologies (Workers edge deployment vs standalone Pages Functions). They must not be collapsed until one topology is retired.
- `.github/workflows/deploy.yml` and `.github/workflows/deploy-cloudflare.yml` had the same deployment job; consolidation keeps the documented `deploy-cloudflare.yml` as the single canonical workflow.

## Build/runtime gaps fixed
- The root build previously omitted the HENDY Digital `/dich-vu/` route even though the dedicated Pages preparation script copied it. Both root and Worker asset routes are now included in `npm run build`.
- The public homepage links `/manifest.webmanifest`, but the Worker static-asset tree did not include that manifest. The asset-sync step now copies the canonical `public/manifest.webmanifest` into `apps/web-user`, where the Edge Router can serve it.
- The build test now guards both routes and the PWA manifest against regressions.

## Known missing source assets / unfinished integrations
- Original Roboto/Open Sans WOFF2 files, original product image sets, opaque WebCard bundles and Slick vendor code are not in the repository; placeholder README files are not substitutes for those assets.
- Admin source uploader currently rejects secrets and is limited to text files and bounded payload sizes; binary release artifacts must use the dedicated R2 artifact flow.
- Queue producer/consumer bindings exist; verify the queue consumer's supported message contract and connect a real build executor before treating queued builds as completed builds.
- Native project folders are wrapper/build scaffolds; platform signing and store publication require configured secrets, runners and external developer accounts.
- Cloudflare Access, D1, KV, R2, Queue, Telegram and GitHub integrations require live account secrets/resources; CI dry-runs do not prove production connectivity.

## Consolidation policy
Do not remove an entry point or deployment layer solely because names look alike. Keep facades, compatibility routes and topology-specific security gates until imports, routing and deployment references are migrated and tests cover the replacement.
