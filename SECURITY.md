# Security

Do not publish secrets, user data or exploit details in an issue. Contact the
maintainer privately using the repository's security advisory feature where
available, or the maintainer contact listed in the repository owner profile.

The extension stores Notion tokens and AI provider keys in `chrome.storage.local`
and sends requests directly to the configured provider. These credentials are not
encrypted on the device. Never include them in logs, diagnostics or bug reports.
The product website does not proxy integration requests or handle service accounts.
