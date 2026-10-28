# Self-hosting the legacy server

The current extension does not need a server. It calls Notion with the user's own token and AI providers with the user's own key, directly from the browser, so there is nothing to host.

This guide applies only to the legacy server in `packages/server`. That server is frozen and is kept only for extension versions released before the client-only version. The current extension source no longer reads `VITE_OAUTH_SERVER_URL` or a Notion client ID, so the build steps below work only with the source of one of those older releases.

The rest of this page describes the legacy setup. In it, the local bookmark library works without a server, and Notion sync and AI enrichment use the server; AI requires a connected Notion destination. Self-hosting includes scheduled sync and batch AI. API provider and hosting charges remain yours.

Requirements: Node 24, pnpm 9.12, and Docker Compose with PostgreSQL 17. The website and Paddle are optional.

1. Install with `pnpm install --frozen-lockfile`.
2. Build `VITE_OAUTH_SERVER_URL=http://localhost:3333 pnpm build:prod`. Load `packages/extension/dist` as an unpacked extension and note its ID. Without `VITE_OAUTH_SERVER_URL`, production builds connect to the official hosted service.
3. Create your own public Notion integration. Register `https://<your-extension-id>.chromiumapp.org/callback` as its OAuth redirect. Create your own duplicatable template using `deploy/notion-template.json` (including the required Source select), and set it as the integration's optional template. Do not use the official integration's credentials. OAuth returns the duplicated template ID used by the existing resolver. See [Notion's authorization setup](https://developers.notion.com/guides/get-started/authorization).
4. Copy `deploy/.env.example` to `deploy/.env`; set your own database password, JWT secret, Notion client credentials and extension allowlist. Percent-encode special characters in the DATABASE_URL password.
5. Run `docker compose --env-file deploy/.env -f deploy/compose.yml up --build -d`. Pending Prisma migrations run before the server starts. Database data persists in the named volume.
6. Rebuild the extension with `VITE_OAUTH_SERVER_URL=http://localhost:3333 VITE_NOTION_CLIENT_ID=<your-client-id> pnpm build:prod` and reload it, then connect Notion. The client ID is public; the client secret belongs only on the server. Google sign-in also needs your own OAuth client: set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server, register `https://<your-extension-id>.chromiumapp.org/google` as an authorized redirect, and build with `VITE_GOOGLE_CLIENT_ID=<your-public-client-id>`. Leave those unset to hide Google sign-in.

For a remote server, terminate HTTPS at your own reverse proxy and build with `VITE_OAUTH_SERVER_URL=https://your-api.example VITE_NOTION_CLIENT_ID=<your-client-id> pnpm build:prod`. Non-local HTTP URLs are rejected. Set `BOOKMARK_ASSISTANT_EXTENSION_PUBLIC_KEY` to your extension's public manifest key if you need the same unpacked extension ID across machines; never use a private signing key in the manifest.

Missing OAuth configuration leaves local management usable. AI requires a separate versioned AES-256-GCM keyring (`AI_CREDENTIAL_ENCRYPTION_KEYS`, `AI_CREDENTIAL_ACTIVE_KEY_VERSION`) and a provider key entered through Settings. Generate secrets locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`; never reuse the JWT secret as an encryption key.

AI keys are application-encrypted. Notion access and refresh tokens currently reside in database fields without application-level encryption. Protect the database, volume, backups and host; use encrypted storage and HTTPS. Losing AI encryption keys makes saved provider keys unreadable. Back up the database and encryption keyring separately and securely.

Accounts: email sign-in and Google sign-in create or adopt the service account. During phase 1 and phase 2, connecting Notion can still create an account. Sessions last 14 days and renew while the extension is used. Disconnecting Notion keeps the account and its plan; deleting the service account is a separate action in Settings.

Email sign-in sends a one-time code through Resend when `RESEND_API_KEY` is set. `EMAIL_FROM` defaults to `Bookmark Assistant <login@bookmarkassistant.com>`; use an address on a domain you control. Without `RESEND_API_KEY`, a personal self-hosted server prints the code once on the server console and does not send mail. That console line contains the code, so use it only on a machine you control and do not collect those logs. This phase does not configure SMTP.

No Paddle configuration is required or used in self-hosted mode. The server decides capabilities; a modified client cannot grant access on the official hosted service.

Cache maintenance is local only: after building the server, use `pnpm -F @bookmark-assistant/server cache stats`, `cache cleanup`, or `cache clear CLEAR_ALL_CACHE`. No cache administration routes are exposed over HTTP.

Plan grants on a hosted deployment are also local only: `pnpm -F @bookmark-assistant/server entitlement show <email>`, `entitlement grant <email>` (permanent developer Pro), `entitlement grant <email> --source gift|trial --expires YYYY-MM-DD`, or `entitlement revoke <email>`. A grant for an email without an account is adopted by the first verified sign-in with that email, whether the sign-in is an email code, Google, or Notion. Paddle subscriptions are managed only through Paddle webhooks.

The supplied deployment targets a personal installation and binds port 3333 to loopback. Changing this to an internet-facing multi-user service requires appropriate operator controls, TLS, backups, monitoring and your own integration configuration.
