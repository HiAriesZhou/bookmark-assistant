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

## Build profiles and resources

- Community is the default profile: neutral Link Library artwork and a local API.
  `pnpm build:community` outputs `packages/extension/dist-community`; `pnpm package`
  packages that profile. Development outputs go to `dist-dev`.
- Official builds require a separately authorized asset workspace. See README.md
  and packages/marketing/README.md. `pnpm build:official` outputs `dist-official`.
  Never copy official artwork, credentials or store snapshots into public source.
- Root package.json owns the version. Public localized copy lives in
  `packages/marketing/content`; neutral brand inputs live in `packages/shared`.
  Run `pnpm resources:sync` and `pnpm resources:check` after changing inputs.
- Generated build directories and source-manifest.json are packaging outputs, not
  source files. A public release must identify its corresponding source revision.

## Architecture boundaries

- Extension: React/Vite/MV3. Popup and Options communicate with the service worker
  through runtime messages; server-api.ts owns backend requests. Chrome bookmarks
  remain the local library's source of truth. Notion is an optional destination.
- Server: Express/Prisma/PostgreSQL. OAuth, sync, AI and Paddle share one codebase.
  Hosted Free/Pro and self-hosted capabilities are decided by server configuration
  and authentication, not client flags. Cache maintenance uses a local command,
  not an HTTP administrator endpoint.
- Types: shared KnowledgeItem, AI and deployment contracts. Keep the basic data
  model compatible with LiteContext; do not fork it by plan.
- Shared: neutral artwork, design tokens and Tailwind preset. Website: Next.js.
  Marketing: public example copy and headless rendering/validation tools.
- Pure core transforms must not depend on Chrome APIs, database access or network
  calls. AI providers reuse the shared provider contract and adapter boundary.
  Basic sync must not depend on AI success, and user edits take precedence.
