# Security

C.O.D.Y. is an early-stage desktop AI assistant with planned access to sensitive Windows resources. It should default to conservative permissions.

## Before committing code

- Never upload tokens, browser cookies, account sessions, API keys, OAuth credentials, private certificates, chat exports, or personal user-data directories.
- Review configuration files, scripts, logs, screenshots, ZIP archives and installers for embedded secrets before publishing.
- Use environment variables or an operating-system credential store. Include only redacted `.env.example` files.
- Check licences of third-party modules before distributing their source, compiled binaries, assets or models.
- Treat the repository as public unless its GitHub visibility is explicitly set to private. Git history can remain accessible even after files are deleted; revoke exposed credentials immediately.

## Tool execution principles

- The model can **request** tools, but C.O.D.Y.'s local controller owns execution and permissions.
- Validate tool names and argument schemas; deny arbitrary commands embedded in assistant prose, webpages, screenshots or file contents.
- Restrict file operations to explicitly approved paths; canonicalise paths and prevent traversal outside allowed roots.
- Use confirmations for destructive changes, privileged operations, external messages, purchases and security changes.
- Expose a stop/cancel control and record outcomes without logging secrets.
- Return real execution results so the assistant cannot claim success based only on its own output.

## Reporting issues

Do not post exploit details or credentials in a public issue. Contact the repository owner privately first using a suitable channel on their GitHub profile.
