---
name: bookmark-assistant-release
description: Prepare and verify Bookmark Assistant extension releases with corresponding GPL source, build profiles, asset separation, and controlled smoke checks.
---

# Bookmark Assistant release

Use the same source tree for official hosted and self-hosted builds. Follow the
maintainer's current operator release checklist when available; public contributors
can use README, deploy/README.md and the checks below without private documents.

## Preparation

- Root package version is the source of truth. Synchronize and check managed copy.
- Community is the default profile and needs no official credentials or assets.
- Official builds require the separate authorized asset workspace and deterministic
  service URLs. Record source revision, asset version and artifact checksums.
- Verify dependency notices, GPL corresponding source and source publication URLs
  before accepting any public binary as a release. Private planning and old Git
  history must never enter a history-free public source candidate.

## Verification

1. Run affected lint, type checks, tests and workspace builds.
2. Run headless MV3, manifest, Popup and Options tests for the selected profile.
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
