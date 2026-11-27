# HENDY Digital service module integration

## Source adaptation

The page adapts usable content from the supplied bundles1.zip into the Hendy App Store visual system. The six service categories are custom software development, technology consulting, software maintenance, mobile applications, project management and customer support. Copy has been rewritten for HENDY rather than preserving the source website's placeholder identity.

## Routes and assets

- Source: apps/web-user/dich-vu/index.html
- Styles: apps/web-user/dich-vu/services.css
- Hero artwork: apps/web-user/dich-vu/hero.webp
- Pages route: /dich-vu/
- Edge Router assets: /web-user/dich-vu/

The Pages build publishes the canonical route at dist/pages/dich-vu/index.html and also copies the complete module into dist/pages/web-user/dich-vu/ for the Edge Worker's static asset binding.

## Deliberately excluded source content

- api.php: Webcard PHP mail handler requiring the original PHP/mail runtime.
- Embedded Google Maps API key and third-party configuration.
- Sample domain, company identity, address, telephone number and email from the source export.
- Generic testimonial content and identities that are not verified.
- subpage/index.html: generic Webcard editor instructions, not finished company content.
- Blank/placeholder legal pages from the source archive; current Store legal pages remain authoritative.
- Unused Webcard vendor bundles, flag sprites and dummy image sets.

No fake contact form, new backend endpoint, database migration or secret was added. The page links into the existing Store and public repository.

## Validation

The structure validator checks the source page, stylesheet and hero file; verifies the Store navigation and Edge route; and rejects known placeholder values. CI verifies both Pages route copies and the hero asset after the production build.
