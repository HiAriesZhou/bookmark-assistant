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

Default community builds use original neutral **Link Library** artwork and a local
server at `http://localhost:3333`. Load `packages/extension/dist-dev` for development,
or build a production community package:

```sh
pnpm build:community
pnpm package
```

The production directory is `packages/extension/dist-community`. Set your public
Notion client ID and server origin explicitly at build time. Server-only credentials
must never be passed as Vite variables. See [self-hosting](deploy/README.md).

## Workspace

Extension: React/Vite/MV3. Server: Express/Prisma/PostgreSQL. Website: Next.js.
Shared types own the KnowledgeItem capture contract; shared styles supply UI tokens.
The marketing workspace contains public example copy and headless rendering tools.

The root package version is the product version source. Localized copy lives in
`packages/marketing/content`; neutral brand sources live in `packages/shared`.
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

## Official builds and source candidates

Official brand artwork and store snapshots live in a separate private asset
workspace. Set `BOOKMARK_ASSISTANT_OFFICIAL_ASSETS` to its root; its expected layout
is documented in packages/marketing/README.md. `pnpm build:official` and
`pnpm package:official` use that workspace and deterministic hosted-service origins,
and require `VITE_NOTION_CLIENT_ID` for the hosted Notion integration.
Official assets are required only for official branding, never for running the code.

`pnpm source:snapshot` exports the current source into a new, history-free directory
under `.build`, with a file checksum manifest. It includes pending source changes
and does not publish a repository. Review provenance and the independent secret
scan before publishing. Public binary releases must identify their exact source
snapshot or commit and include the applicable third-party notices.

Older AGPL releases retain their existing grants. Historical repositories and npm
core packages are archival references; current core implementations live here.
