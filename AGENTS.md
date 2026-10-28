# Bookmark Assistant repository rules

Bookmark Assistant is a free, open-source Chrome extension with a GPL-3.0-only source
tree. It runs entirely in the browser: no account, no plans and no service of its own.
Keep AI classification, new destinations and LiteContext expansion out of unrelated
changes.

## Code, assets and documentation

- Keep credentials, logs and real user data out of source, fixtures and documentation.
- Builds work without official services or credentials. Users configure their own
  destinations (a Notion token) and AI provider keys inside the extension.
- Official artwork and store snapshots are GPL-3.0-only files in this repository.
  The Bookmark Assistant name and logo are protected by TRADEMARKS.md, not by
  hiding files. Preserve third-party licenses and trademark ownership; keep
  third-party logos out of the tree. Do not add commercial-use restrictions.
- Public copy names the product Bookmark Assistant and presents it as free and open
  source. Do not mention plans, tiers, pricing, accounts or a hosted service.
- Product versions and runtime public copy have one source; profile-specific build
  resources go into ignored output directories. Never edit generated mirrors.
- Keep README as an entry point. Product planning, strategy, architecture decisions
  and operational runbooks remain in the maintainer's Obsidian vault. Do not create
  a docs directory. Public deployment and legal entry files are appropriate here.
- Shared KnowledgeItem/ContextItem contracts stay compatible. Data format
  compatibility does not grant permission to copy GPL implementation code into an
  incompatible downstream project.

## Architecture

- Extension: React/Vite/MV3. Popup and Options communicate with the service worker
  through runtime messages; the background owns destination and AI requests. Chrome
  bookmarks remain the local library's source of truth.
- Notion is an optional destination. The user pastes a personal access token or an
  internal integration token, and the background calls `api.notion.com` directly.
  New destinations, such as Obsidian, are separate changes.
- AI is optional and uses the user's own provider key, called directly from the
  extension. AI providers reuse the shared provider contract and adapter boundary;
  provider hosts are optional host permissions requested when needed.
- Notion tokens and AI keys stay in `chrome.storage.local`. Never put them in
  `chrome.storage.sync`, logs, diagnostics or error reports.
- Legacy server (`packages/server`, Express/Prisma/PostgreSQL): frozen. It only serves
  extension versions released before the client-only version and receives no new
  features. Merges to `main` still redeploy it, so its build and tests must stay
  green, and shared types it uses must not change until it is shut down.
- Types hold the shared KnowledgeItem, AI and deployment contracts. Shared holds
  brand artwork and scrollbar styles. Website: Next.js. Marketing: public copy and
  headless rendering/validation tools.
- Pure core transforms must not depend on Chrome APIs, storage or network calls.

## Verification

- Use Node 24, pnpm 9.12 and task-appropriate lint, type checks, tests and builds.
  Run individual tests through the root Vitest configuration so shared aliases and
  setup apply.
- All routine browser tests, E2E and screenshots must use CLI-only headless automation.
  Do not open, focus or operate the user's browser, use headed mode or open reports.
- Real Chrome GUI smoke is a separate gate requiring an explicit request and approval.
  Green headless checks do not prove a real Notion workspace or store installation.
- Basic sync never depends on AI success; changes the user made in Notion take
  priority over values written by a sync.
- The extension background owns destination and key storage. Commit results against
  the destination connection captured when the work started, so replies that finish
  after a disconnect or token change are dropped. Bulk sync runs once per connection.
  Startup cleanup removes obsolete storage keys by exact name only.
- For non-trivial bug fixes, add the smallest durable prevention such as a regression
  test, validation or type constraint. Do not add settings or services unnecessarily.

## Publication

Prepare an audited source snapshot without private Git history. Do not publish,
rename repositories, submit store packages, deploy production or announce releases
without the corresponding user direction. Each binary release needs corresponding
source, build instructions, license notices and recorded checksums. No public CI job
may access official deployment or asset credentials.

The former public npm core packages are historical; current runtime packages use
workspace dependencies. Do not publish personal npm packages incidentally. If a
publication is explicitly requested, use the maintainer's dedicated npm config,
confirm the authenticated account and never print tokens.

Report changed surfaces, verification and gaps, public/private review, LiteContext
contract impact and follow-ups.
