# Shared resources

Design tokens and Tailwind configuration are GPL-3.0-only source code.
`brand.json` and `assets/brand` contain the official Bookmark Assistant brand
(GPL-3.0-only artwork; the name and logo are governed by TRADEMARKS.md). The favicon
master is `assets/brand/paperbird-master.png`; regenerate favicons with
`node scripts/generate-favicons.mjs` and validate them with `--check`.

Builds copy these inputs into ignored output directories; builds never rewrite
tracked source files.

The root package version owns the product release. Workspace versions are internal
implementation versions and are not additional product editions.
