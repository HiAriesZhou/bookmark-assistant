# Security

Do not publish secrets, user data or exploit details in an issue. Contact the
maintainer privately using the repository's security advisory feature where
available, or the maintainer contact listed in the repository owner profile.

Self-hosting operators control their own database, Notion credentials, JWT secret
and AI keyring. Read deploy/README.md for the current storage and deployment
boundaries. CORS and the extension ID header are not proof of user identity;
privileged operations must use server-side authorization.
