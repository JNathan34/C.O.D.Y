# Development and releases

The GitHub repository is the source baseline. Develop in the current `CODY-App` tree, preserve unrelated work, run the frontend tests, then build and inspect the Windows packages.

## Source changes

Keep generated binaries, profiles, credentials, local reports and dependency caches out of commits. Include the tests and documentation needed to understand behavior changes. Avoid changing native compatibility identifiers solely to rename visible labels.

## Build

Follow the root README to install dependencies and restore the versioned native build inputs. Close the development app before running `Build-Engine.bat` or `Build-CODY-Standalone.bat`.

## Release

1. Increase the app version in `CODY-App/frontend/original-cody/package.json`.
2. Update the changelog and release notes.
3. Run the tests, build the NSIS installer and run `npm run release:check` from CODY-App.
4. Create and inspect the GitHub draft release with the matching installer and latest.yml.
5. Publish the release after its assets are complete. Keep earlier release assets available.

If native build prerequisites change, create a new versioned build-input archive and commit its checksum manifest with the source. Never upload local account/profile folders as build dependencies.

See [the detailed release guide](../CODY-App/docs/GITHUB-UPDATES.md).
