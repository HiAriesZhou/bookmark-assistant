# Working with Bookmark Assistant

Read `AGENTS.md` first for product scope, source and asset boundaries, contribution
rules and the headless testing policy. Use README.md as the development entry point
and deploy/README.md for self-hosting.

## Development and verification

Use Node 24 and pnpm 9.12.0. Workspaces live in `packages/*`.

```sh
pnpm install --frozen-lockfile
pnpm -F @bookmark-assistant/types build
pnpm dev
pnpm dev:server
pnpm dev:website

pnpm lint
pnpm -F @bookmark-assistant/extension type-check
pnpm test
pnpm build:all
pnpm test:e2e:extension
pnpm source:check
```

Run individual tests through the root Vitest configuration so shared type aliases
and test setup are included. Routine browser tests must remain headless.

## Builds and resources

- There is one product build with the official Bookmark Assistant brand.
  `pnpm build:prod` outputs `packages/extension/dist` and connects to the official
  service unless `VITE_OAUTH_SERVER_URL` selects another server; `pnpm package`
  packages it. Development builds go to `dist-dev` and default to a local API.
- Official artwork and store snapshots are GPL-3.0-only source in this repository;
  the name and logo are governed by TRADEMARKS.md. Never commit credentials.
  Third-party marks such as the Google Chrome logo stay out of the tree.
- Root package.json owns the version. Public localized copy lives in
  `packages/marketing/content`; brand inputs live in `packages/shared`.
  Run `pnpm resources:sync` and `pnpm resources:check` after changing inputs.
- Generated build directories and source-manifest.json are packaging outputs, not
  source files. A public release must identify its corresponding source revision.

## Architecture boundaries

- Extension: React/Vite/MV3. Popup and Options communicate with the service worker
  through runtime messages; server-api.ts owns backend requests. Chrome bookmarks
  remain the local library's source of truth. Notion is an optional destination.
- Server: Express/Prisma/PostgreSQL. OAuth, sync, AI and Paddle share one codebase.
  Hosted Free/Pro and self-hosted capabilities are decided by server configuration
  and authentication, not client flags. Cache maintenance and plan grants
  (`cache`, `entitlement`) use local commands, not HTTP administrator endpoints.
- Notion OAuth creates the service account; plans belong to that account, not to
  the Notion connection. Disconnecting Notion keeps the account, session and plan;
  only the explicit account deletion removes the server record. Local bookmark
  management never requires an account.
- Types: shared KnowledgeItem, AI and deployment contracts. Keep the basic data
  model compatible with LiteContext; do not fork it by plan.
- Shared: brand artwork and shared scrollbar styles. Website: Next.js.
  Marketing: public example copy and headless rendering/validation tools.
- Pure core transforms must not depend on Chrome APIs, database access or network
  calls. AI providers reuse the shared provider contract and adapter boundary.
  Basic sync must not depend on AI success, and user edits take precedence.
