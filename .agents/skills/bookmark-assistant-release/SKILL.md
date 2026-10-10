---
name: bookmark-assistant-release
description: Prepare and verify Bookmark Assistant extension releases with corresponding GPL source, service configuration, store snapshots, and controlled smoke checks.
---

# Bookmark Assistant release

Use the same source tree for official hosted and self-hosted builds. Follow the
maintainer's current operator release checklist when available; public contributors
can use README, deploy/README.md and the checks below without private documents.

## Preparation

- Root package version is the source of truth. Synchronize and check managed copy.
- `pnpm package` builds the official extension against the official service from
  this repository alone. Record the tagged source revision and artifact checksums.
- Self-hosted builds set `VITE_OAUTH_SERVER_URL` and their own Notion client ID.
- Verify dependency notices, GPL corresponding source and source publication URLs
  before accepting any public binary as a release. Private planning and old Git
  history must never enter a history-free public source candidate.

## Verification

1. Run affected lint, type checks, tests and workspace builds.
2. Run headless MV3, manifest, Popup and Options tests.
3. Validate the actual ZIP payload: entrypoints, locale, icons, license and version;
   exclude environment files, source maps, logs, lockfiles and dependencies.
4. Test hosted Free/Pro and self-hosted capabilities; service configuration controls
   access, not client flags. Basic sync remains independent of AI and user edits win.
5. Real Chrome/OAuth/Notion/AI smoke is a separately authorized release gate. Do not
   open a visible browser as a fallback for routine tests or claim mock coverage
   proves production integration.

## Publication and report

This skill does not itself authorize repository publication, store submission,
production deployment, tags or announcements. Follow the user's granted scope.
Report exact checks, artifacts, remaining external gates, asset/secret review,
Free/Pro and self-hosted behavior, LiteContext contract impact and follow-ups.
