<div align="center">

<img src="packages/shared/assets/brand/logo.png" alt="Bookmark Assistant logo" width="96" height="96">

# Bookmark Assistant

**Manage the Chrome bookmarks you already have.**

Search, edit, tag and organize your library locally. Sync to Notion with your own token
when you want an external copy, and get folder suggestions from AI with your own
provider key. Free and open source; it runs entirely in the browser.

[Chrome Web Store](https://chromewebstore.google.com/detail/khffaaemphidjmhokafmiilkcjpgiije) ·
[Website](https://bookmarkassistant.com) ·
[Legacy server](deploy/README.md) ·
[Contributing](CONTRIBUTING.md)

[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)
![Node 24](https://img.shields.io/badge/node-24-339933)

<img src="packages/website/public/assets/laptop-en.png" alt="Bookmark Assistant local library with folders, search, descriptions and tags" width="760">

</div>

## Features

- **Local library**: search titles, URLs, descriptions and tags; edit details, move
  bookmarks between folders, find duplicates and remove what you no longer need.
  Chrome bookmarks stay the source of truth.
- **Bookmarks and Reading List to Notion** (optional): paste a Notion personal access
  token or internal integration token, then pick a database or let the extension
  create one under a page. Sync on demand or on a schedule (six hours or more); the
  extension calls the Notion API directly and does not overwrite your Notion edits.
- **Save the current page** to Notion with its title, URL and meta description.
- **AI organize** (optional): with your own OpenAI, Anthropic, Gemini, DeepSeek, Groq or
  MiniMax key, get folder suggestions for the bookmarks in view, preview them, apply
  the moves you select and undo the last run. Only titles, folder paths and URLs
  without query strings are sent to the provider.

There is no account, sign-in or server of its own. Notion tokens and AI keys stay in
`chrome.storage.local`.

## Repository layout

| Package              | Contents                                                          |
| -------------------- | ----------------------------------------------------------------- |
| `packages/extension` | Chrome extension (React, Vite, Manifest V3)                       |
| `packages/server`    | Legacy API for older extension versions; frozen (Express, Prisma) |
| `packages/website`   | Product website (Next.js)                                         |
| `packages/types`     | Shared KnowledgeItem, AI and deployment contracts                 |
| `packages/shared`    | Brand artwork and shared scrollbar styles                         |
| `packages/marketing` | Localized public copy and headless rendering tools                |

The root package version is the product version source. Localized copy lives in
`packages/marketing/content` and brand sources in `packages/shared`. Generated mirrors
are build artifacts: run `pnpm resources:sync` and `pnpm resources:check` after
changing their source inputs.

## Development

Use Node 24 and pnpm 9.12.0:

```sh
pnpm install --frozen-lockfile
pnpm -F @bookmark-assistant/types build
pnpm dev            # extension, loads from packages/extension/dist-dev
pnpm dev:website
```

The extension needs no server. `packages/server` is the frozen legacy API that serves
only extension versions released before the client-only version; it receives no new
features. See [deploy/README.md](deploy/README.md) if you need to run it.

Production builds are the official extension by default. The output directory is
`packages/extension/dist`:

```sh
pnpm build:prod
pnpm package
```

The extension needs no credentials at build time: users connect Notion with their own
token in Options. A build for another site sets `VITE_WEBSITE_URL` and its own links
(`VITE_FAQ_URL`, `VITE_PRIVACY_URL`, `VITE_TERMS_URL`, `VITE_SOURCE_URL`) and is then
not the official build. Never pass credentials as Vite variables.

## Verification

```sh
pnpm lint
pnpm -F @bookmark-assistant/extension type-check
pnpm test
pnpm build:all
pnpm exec playwright install chromium
pnpm test:e2e:extension
pnpm source:check
```

Routine testing is headless and never opens the system browser.

## Releases and source

Official artwork, store snapshots and official links are part of this repository, so a
tagged commit is the complete corresponding source of a store package. Public binary
releases must identify their exact source snapshot or commit and include the applicable
third-party notices.

`pnpm source:snapshot` exports the current source, including pending changes, into a
new history-free directory under `.build` with a file checksum manifest. It does not
publish a repository. Review provenance and run the independent secret scan before
publishing.

Older AGPL releases retain their existing grants. Historical repositories and npm
core packages are archival references; current core implementations live here.

## License and trademarks

The extension, website, legacy server and build tools are licensed under
**GPL-3.0-only**; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Bookmark
Assistant name and logo are covered by [TRADEMARKS.md](TRADEMARKS.md): forks and
independent deployments must use their own name and artwork.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).
