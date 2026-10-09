# Bookmark Assistant repository rules

Bookmark Assistant is one product with a GPL-3.0-only source tree. Official hosted
Free/Pro plans and self-hosted deployments share its core implementation and data
model. Keep AI classification, new destinations and LiteContext expansion out of
unrelated changes.

## Code, assets and documentation

- Keep credentials, logs and real user data out of source, fixtures and documentation.
- Community builds must work without official services, brand assets or credentials.
- Official artwork and store snapshots live in a separate private asset workspace.
  Preserve third-party licenses and trademark ownership. UI code, CSS and neutral
  artwork remain GPL; do not add commercial-use restrictions to the code license.
- Product versions and runtime public copy have one source; profile-specific build
  resources go into ignored output directories. Never edit generated mirrors.
- Keep README as an entry point. Product planning, strategy, architecture decisions
  and operational runbooks remain in the maintainer's Obsidian vault. Do not create
  a docs directory. Public deployment and legal entry files are appropriate here.
- Shared KnowledgeItem/ContextItem contracts stay compatible. Free/Pro must not fork
  the basic data model. Data format compatibility does not grant permission to copy
  GPL implementation code into an incompatible downstream project.

## Verification

- Use Node 24, pnpm 9.12 and task-appropriate lint, type checks, tests and builds.
- All routine browser tests, E2E and screenshots must use CLI-only headless automation.
  Do not open, focus or operate the user's browser, use headed mode or open reports.
- Real Chrome GUI smoke is a separate release-only gate requiring an explicit request
  and approval. Green headless checks do not prove real OAuth or store installation.
- Entitlements are decided by the server. CORS and extension ID headers are not user
  authentication. Test hosted Free/Pro and self-hosted capability boundaries.
- Basic sync never depends on AI success; user edits take priority over AI results.
- For non-trivial bug fixes, add the smallest durable prevention such as a regression
  test, validation or type constraint. Do not add settings or services unnecessarily.

## Publication

Prepare an audited source snapshot without private Git history. Do not publish,
rename repositories, submit store packages, deploy production or announce releases
without the corresponding user direction. Treat official and community output
directories separately. Each binary release needs corresponding source, build
instructions, license notices and recorded checksums. No public CI job may access
official deployment or asset credentials.

The former public npm core packages are historical; current runtime packages use
workspace dependencies. Do not publish personal npm packages incidentally. If a
publication is explicitly requested, use the maintainer's dedicated npm config,
confirm the authenticated account and never print tokens.

Report changed surfaces, verification and gaps, public/private review, hosted
Free/Pro behavior, self-hosted behavior, LiteContext contract impact and follow-ups.
