# Releasing

Cryox Gemini Drive uses semantic versioning while the project remains in alpha.

## Before release

1. Update `package.json` and `CHANGELOG.md`.
2. Run `npm run verify`.
3. Confirm that no session exports, vault keys, private handles, runtime state, or signed provider URLs are present in the repository.
4. Push the release commit to `main` and wait for CI and CodeQL to complete.

## Publish

Open the **Release** workflow in GitHub Actions and run it with the exact version from `package.json`, without a `v` prefix.

The workflow validates the source, extracts the matching version section from `CHANGELOG.md` as the release notes, creates an annotated `vX.Y.Z` tag, builds a source ZIP, generates a SHA-256 checksum, and publishes both files in a GitHub Release.

Published tags and release artifacts should be treated as immutable. Corrections are released under a new version.
