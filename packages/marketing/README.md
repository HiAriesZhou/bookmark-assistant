# Public copy and rendering tools

`content/en.json` and `content/zh-CN.json` own the official product copy. Runtime UI
strings stay in the extension locale catalogs. `copy:sync` updates canonical locale
fields and the public website copy module; `copy:check` rejects drift.

Rendering scripts, canvas code and the committed official images are
GPL-3.0-only; the name and logo are governed by TRADEMARKS.md. Generated output
under `generated` is disposable; review renders before promoting them.

Approved images live in `assets/store` and `assets/website`. `store` holds the
Chrome Web Store upload snapshot of the latest release (listing text, screenshots,
promo images and release locks); `pnpm resources:check` verifies that its icon and
promo copies match the approved sources. The DashBye operator configuration with
local endpoints is not part of this repository.

Product Hunt and Chrome names and marks retain third-party ownership. No public CI
job needs official account credentials.
