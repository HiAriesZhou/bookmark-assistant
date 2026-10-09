# Self-hosting

The local bookmark library works without a server. Notion sync and AI enrichment use the server; AI currently requires a connected Notion destination. Self-hosting includes scheduled sync and batch AI. API provider and hosting charges remain yours.

Requirements: Node 24, pnpm 9.12, and Docker Compose with PostgreSQL 17. The website and Paddle are optional.

1. Install with `pnpm install --frozen-lockfile`.
2. Build `pnpm build:community`. Load `packages/extension/dist-community` as an unpacked extension and note its ID.
3. Create your own public Notion integration. Register `https://<your-extension-id>.chromiumapp.org/callback` as its OAuth redirect. Create your own duplicatable template using `deploy/notion-template.json` (including the required Source select), and set it as the integration's optional template. Do not use the official integration's credentials. OAuth returns the duplicated template ID used by the existing resolver. See [Notion's authorization setup](https://developers.notion.com/guides/get-started/authorization).
4. Copy `deploy/.env.example` to `deploy/.env`; set your own database password, JWT secret, Notion client credentials and extension allowlist. Percent-encode special characters in the DATABASE_URL password.
5. Run `docker compose --env-file deploy/.env -f deploy/compose.yml up --build -d`. Pending Prisma migrations run before the server starts. Database data persists in the named volume.
6. Rebuild the extension with `VITE_NOTION_CLIENT_ID=<your-client-id> pnpm build:community` and reload it, then connect Notion. The client ID is public; the client secret belongs only on the server.

For a remote server, terminate HTTPS at your own reverse proxy and build with `VITE_OAUTH_SERVER_URL=https://your-api.example VITE_NOTION_CLIENT_ID=<your-client-id> pnpm build:community`. Non-local HTTP URLs are rejected. Set `BOOKMARK_ASSISTANT_EXTENSION_PUBLIC_KEY` to your extension's public manifest key if you need the same unpacked extension ID across machines; never use a private signing key in the manifest.

Missing OAuth configuration leaves local management usable. AI requires a separate versioned AES-256-GCM keyring (`AI_CREDENTIAL_ENCRYPTION_KEYS`, `AI_CREDENTIAL_ACTIVE_KEY_VERSION`) and a provider key entered through Settings. Generate secrets locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`; never reuse the JWT secret as an encryption key.

AI keys are application-encrypted. Notion access and refresh tokens currently reside in database fields without application-level encryption. Protect the database, volume, backups and host; use encrypted storage and HTTPS. Losing AI encryption keys makes saved provider keys unreadable. Back up the database and encryption keyring separately and securely.

No Paddle configuration is required or used in self-hosted mode. The server decides capabilities; a modified client cannot grant access on the official hosted service.

Cache maintenance is local only: after building the server, use `pnpm -F @bookmark-assistant/server cache stats`, `cache cleanup`, or `cache clear CLEAR_ALL_CACHE`. No cache administration routes are exposed over HTTP.

The supplied deployment targets a personal installation and binds port 3333 to loopback. Changing this to an internet-facing multi-user service requires appropriate operator controls, TLS, backups, monitoring and your own integration configuration.
