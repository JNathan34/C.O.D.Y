# Development workflow

C.O.D.Y. currently has three independent AI development conversations and a human tester; each chat receives source ZIPs rather than sharing a live filesystem.

## Responsibilities

- **Core AI chat:** conversation adapter, tool engine and local Windows operations.
- **GUI chat:** Electron shell, Dynamic Island, visuals and settings.
- **Research chat:** technical research, architectural guidance, documentation and integration contracts.
- **Human tester:** run builds locally, report reproducible bugs, choose which completed ZIP becomes the next baseline.

## Handoff process

1. Preserve the **last-known-good** full project ZIP.
2. Make changes against that exact baseline, not an older copy.
3. Record changed files, new dependencies, tests and unresolved issues.
4. Merge new backend changes into the current app before producing a new full ZIP.
5. Test the entire application, not only the changed component.
6. Commit source changes to the repository after reviewing secrets, licences and generated artefacts.

## Naming

Suggested test build names: `CODY-v0.1.0-dev.1.zip`, `CODY-v0.1.0-dev.2.zip`.

Avoid committing ZIPs of proprietary HeyClicky builds or account-specific browser sessions. Document external dependencies rather than copying their binaries.
