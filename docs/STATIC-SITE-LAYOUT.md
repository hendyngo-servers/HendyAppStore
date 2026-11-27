# Root static website layout

The repository now includes the requested top-level website entry points while retaining the Cloudflare-first monorepo.

## Source paths

- index.html is the public Store landing page and is mirrored to apps/web-user/index.html at build time.
- subpage/index.html is the Store information page.
- legal-notice/index.html is the legal notice.
- privacy/index.html is the privacy notice.
- js/custom.261126163157.js and css/custom.261126163517.css are site-level enhancements layered over the existing Store frontend.
- g/fonts.css loads Roboto and Open Sans through the Google Fonts CSS2 API.
- bundles/flag-icon-css is populated during build from the pinned MIT flag-icons 7.6.0 npm package.
- images contains a transparent fallback and reserved paths for the five image IDs in the supplied tree.
- webcard is reserved for verified legacy files; opaque runtime chunks were not present in the source repository and are not fabricated.

## Build and deploy behaviour

npm run build runs scripts/sync-static-site-assets.mjs before the regular Pages bundle build. The sync step mirrors the top-level site into apps/web-user, copies flag SVG assets and CSS from node_modules/flag-icons, and renders the Worker-side sitemap from HENDY_PUBLIC_STORE_URL when set. scripts/prepare-pages.mjs copies the same public routes and assets into dist/pages and renders the Pages sitemap from the provisioned Pages origin.

The Cloudflare Edge Router maps /subpage/, /legal-notice/, /privacy/ and /sitemap.xml into the public asset bundle. Admin routes and the existing Worker API remain in place.

## PHP compatibility note

api.php is a tightly allow-listed, GET-only compatibility bridge for conventional PHP hosting. It can proxy only health, apps and releases to an HTTPS HENDY_API_BASE_URL. It is intentionally not copied to dist/pages or apps/web-user/: Cloudflare Pages and Workers do not execute PHP, and publishing PHP source as a static asset would be unsafe. The canonical production API remains the Cloudflare Worker at /api/*.

## Assets not present in the original repository

The GitHub source snapshot did not contain the 9 Roboto WOFF2 files, 11 Open Sans WOFF2 files, five groups of original product images, WebCard bundles or Slick vendor bundle named in the requested tree. The new pages use Google Fonts through g/fonts.css; reserved font, image and WebCard paths contain explanatory README files, not counterfeit binaries. The actual flag SVG collection is supplied reproducibly by npm during build.
