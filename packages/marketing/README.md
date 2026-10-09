# Public copy and rendering tools

`content/en.json` and `content/zh-CN.json` own community example copy. Runtime UI
strings stay in the extension locale catalogs. `copy:sync` updates canonical locale
fields and the public website copy module; `copy:check` rejects drift.

Rendering scripts and canvas code are GPL-3.0-only. The committed example images
are original neutral artwork. Generated output under `generated` is disposable.
Official visual artwork and approved store upload snapshots are separately managed.

## Official asset workspace

Set `BOOKMARK_ASSISTANT_BUILD_PROFILE=official` and
`BOOKMARK_ASSISTANT_OFFICIAL_ASSETS=<private-workspace-root>`. The default local
path is the ignored `.official-assets` directory. It mirrors these resource paths:

- `packages/shared/brand.json` and `packages/shared/assets/brand`
- `packages/marketing/content`, `assets/store`, `assets/website`, and `store`
- `packages/website/public/assets` and optional official verification assets
- `dashbye.config.yml` and `assets.lock.json`

Official artwork has one editable source in that workspace. Store snapshots remain
release copies; the existing store snapshot checker validates their approved source.
After an approved input change, run `node scripts/lock-official-assets.mjs` before
building and commit the resource lock in the private asset repository. Official
builds reject altered inputs until the lock is refreshed.
Chrome and Product Hunt artwork retain third-party ownership. No generic public CI
job needs this workspace or official account credentials.

Use the same renderer with the selected profile; official promotion writes to the
private workspace, not the public source. Brand and website build mirrors use
separate generated namespaces. Review images before official publication.
