# Bookmark Assistant

Manage existing Chrome bookmarks locally, connect Notion when you want an external
copy, and optionally generate AI summaries and tags with your own provider key.
The extension, server, website, billing implementation and build tools share one
source tree licensed under **GPL-3.0-only**. See LICENSE, NOTICE and TRADEMARKS.md.

Official hosted services offer Free and Pro plans. Self-hosted deployments include
scheduled sync and batch AI without an official subscription. Hosting and provider
costs are the operator's responsibility. AI currently requires a connected Notion
destination; the local bookmark library works independently.

## Development

Use Node 24 and pnpm 9.12.0:

```sh
pnpm install --frozen-lockfile
pnpm -F @bookmark-assistant/types build
pnpm dev
pnpm dev:server
pnpm dev:website
```

Development builds connect to a local server at `http://localhost:3333`; load
`packages/extension/dist-dev`. Production builds are the official extension and
connect to the official hosted service by default:

```sh
pnpm build:prod
pnpm package
```

The production directory is `packages/extension/dist`. To use your own server, set
`VITE_OAUTH_SERVER_URL` and your own `VITE_NOTION_CLIENT_ID` at build time; official
links and the official Notion client ID then no longer apply. Server-only credentials
must never be passed as Vite variables. See [self-hosting](deploy/README.md).

## Workspace

Extension: React/Vite/MV3. Server: Express/Prisma/PostgreSQL. Website: Next.js.
Shared types own the KnowledgeItem capture contract; shared styles supply scrollbar rules.
The marketing workspace contains public example copy and headless rendering tools.

The root package version is the product version source. Localized copy lives in
`packages/marketing/content`; brand sources live in `packages/shared`.
Generated mirrors are build artifacts. Run `pnpm resources:sync` and
`pnpm resources:check` after changing their source inputs.

## Verification

```sh
pnpm lint
pnpm test
pnpm build:all
pnpm exec playwright install chromium
pnpm test:e2e:extension
pnpm source:check
```

Routine testing is headless and never opens the system browser. See CONTRIBUTING.md
and SECURITY.md for contribution and disclosure guidance.

## Official releases and source candidates

Official artwork, store snapshots and the hosted-service endpoints are part of this
repository, so a tagged commit is the complete corresponding source of a store
package. The Bookmark Assistant name and logo are covered by TRADEMARKS.md.

`pnpm source:snapshot` exports the current source into a new, history-free directory
under `.build`, with a file checksum manifest. It includes pending source changes
and does not publish a repository. Review provenance and the independent secret
scan before publishing. Public binary releases must identify their exact source
snapshot or commit and include the applicable third-party notices.

Older AGPL releases retain their existing grants. Historical repositories and npm
core packages are archival references; current core implementations live here.
