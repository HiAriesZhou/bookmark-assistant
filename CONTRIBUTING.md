# Contributing

Use Node 24 and pnpm 9.12. Install with `pnpm install --frozen-lockfile`. Builds
and tests require no official credentials.

Keep changes focused and add regression coverage for behavioral fixes. Run the
affected workspace checks and headless tests. Do not open a visible browser for
routine automation, include user data in fixtures, or commit credentials or logs.

Contributions to project-owned code are licensed under GPL-3.0-only. You retain
your copyright. Sign off commits with `git commit -s` to certify the Developer
Certificate of Origin 1.1: https://developercertificate.org/ . Only contribute
code you have the right to submit; preserve notices for third-party material.

Official artwork is included under GPL-3.0-only; the name and logo are governed by
TRADEMARKS.md. The extension runs without a server. Contributors can configure
their own Notion token and AI provider key to verify the optional integrations;
`deploy/README.md` covers the frozen server for older extension versions.
