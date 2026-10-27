# Bookmark Assistant repository rules

Bookmark Assistant is one product with a GPL-3.0-only source tree. Official hosted
Free/Pro plans and self-hosted deployments share its core implementation and data
model. Keep AI classification, new destinations and LiteContext expansion out of
unrelated changes.

## Code, assets and documentation

- Keep credentials, logs and real user data out of source, fixtures and documentation.
- Self-hosted builds must work without official services or credentials; they select
  their own server and integration configuration.
- Official artwork and store snapshots are GPL-3.0-only files in this repository.
  The Bookmark Assistant name and logo are protected by TRADEMARKS.md, not by
  hiding files. Preserve third-party licenses and trademark ownership; keep
  third-party logos out of the tree. Do not add commercial-use restrictions.
- Public copy names the product Bookmark Assistant and its tiers Hosted Free, Hosted Pro
  and Self-hosted. Do not describe editions as OSS / Commercial.
- Product versions and runtime public copy have one source; profile-specific build
  resources go into ignored output directories. Never edit generated mirrors.
- Keep README as an entry point. Product planning, strategy, architecture decisions
  and operational runbooks remain in the maintainer's Obsidian vault. Do not create
  a docs directory. Public deployment and legal entry files are appropriate here.
- Shared KnowledgeItem/ContextItem contracts stay compatible. Free/Pro must not fork
  the basic data model. Data format compatibility does not grant permission to copy
  GPL implementation code into an incompatible downstream project.

## Architecture

- Extension: React/Vite/MV3. Popup and Options communicate with the service worker
  through runtime messages; server-api.ts owns backend requests. Chrome bookmarks
  remain the local library's source of truth. Notion is an optional destination.
- Server: Express/Prisma/PostgreSQL. OAuth, sync, AI and Paddle share one codebase.
  Hosted Free/Pro and self-hosted capabilities are decided by server configuration
  and authentication, not client flags. Cache maintenance and plan grants
  (`cache`, `entitlement`) use local commands, not HTTP administrator endpoints.
- Email and Google sign-in create or adopt the service account. During phase 1
  and phase 2, Notion authorization can still create an account. Plans belong to
  that account, not to the Notion connection. Disconnecting Notion keeps the
  account, session and plan; only the explicit account deletion removes the server
  record. Local bookmark management never requires an account.
- Types hold the shared KnowledgeItem, AI and deployment contracts. Shared holds
  brand artwork and scrollbar styles. Website: Next.js. Marketing: public copy and
  headless rendering/validation tools.
- Pure core transforms must not depend on Chrome APIs, database access or network
  calls. AI providers reuse the shared provider contract and adapter boundary.

## Verification

- Use Node 24, pnpm 9.12 and task-appropriate lint, type checks, tests and builds.
  Run individual tests through the root Vitest configuration so shared aliases and
  setup apply.
- All routine browser tests, E2E and screenshots must use CLI-only headless automation.
  Do not open, focus or operate the user's browser, use headed mode or open reports.
- Real Chrome GUI smoke is a separate release-only gate requiring an explicit request
  and approval. Green headless checks do not prove real OAuth or store installation.
- Entitlements are decided by the server. CORS and extension ID headers are not user
  authentication. Test hosted Free/Pro and self-hosted capability boundaries.
- Basic sync never depends on AI success; user edits take priority over AI results.
- Async Express route handlers must forward rejected promises to error middleware;
  use the shared `asyncHandler` when errors are not fully handled in the route.
- The extension background owns account-scoped storage. Commit results through
  `withCurrentAccount` with the context captured when the work started, so replies
  that finish after logout, deletion or reconnection are dropped. Bulk sync runs
  once per server account; a new account revision waits for the earlier sync,
  whose server request cannot be cancelled. Startup cleanup removes obsolete
  storage keys by exact name only.
- For non-trivial bug fixes, add the smallest durable prevention such as a regression
  test, validation or type constraint. Do not add settings or services unnecessarily.

## Publication

Prepare an audited source snapshot without private Git history. Do not publish,
rename repositories, submit store packages, deploy production or announce releases
without the corresponding user direction. Each binary release needs corresponding source, build
instructions, license notices and recorded checksums. No public CI job may access
official deployment or asset credentials.

The former public npm core packages are historical; current runtime packages use
workspace dependencies. Do not publish personal npm packages incidentally. If a
publication is explicitly requested, use the maintainer's dedicated npm config,
confirm the authenticated account and never print tokens.

Report changed surfaces, verification and gaps, public/private review, hosted
Free/Pro behavior, self-hosted behavior, LiteContext contract impact and follow-ups.
