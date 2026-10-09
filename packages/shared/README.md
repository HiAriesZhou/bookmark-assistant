# Shared resources

Design tokens and Tailwind configuration are GPL-3.0-only source code.
`brand.json` and `assets/brand` contain neutral community branding. Its master is
the original `assets/community/library.svg`; regenerate example images using
`node scripts/generate-community-assets.mjs` at the root.

Official builds read the separately managed asset workspace through the common
build-profile resolver. Assets are copied into profile-specific output namespaces;
switching profiles does not rewrite tracked source files.

The root package version owns the product release. Workspace versions are internal
implementation versions and are not additional product editions.
