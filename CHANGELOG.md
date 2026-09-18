# Changelog

All notable changes to this project are documented in this file.

## Unreleased

## 0.4.0 - 2026-09-18

- Relicensed the project from MIT to `GPL-3.0-only` for releases from this change forward. Previously published MIT-licensed versions remain available under their original terms.
- Expanded the README with the vault architecture, encryption and recovery model, local API, persistent state, security boundaries, and operational limitations.
- Removed the Windows-only `START.bat` launcher so `npm install` and `npm start` remain the canonical cross-platform setup and launch path.
- Aligned CodeQL pull-request execution with the repository's required `Analyze JavaScript` status check.
- Fixed a file-picker upload regression where clearing the input could empty the live `FileList` before the upload request started.

- Follow Gemini same-origin bootstrap redirects, retry with the complete browser cookie export before reduced-cookie fallback, and use a browser-compatible TLS/HTTP2 transport for Gemini Web requests.
- Fixed Gemini browser-session loading for full and wrapped cookie exports, added full-cookie fallback after essential-cookie bootstrap rejection, and surfaced precise session verification errors.

- Removed the application-level per-file size cap and all file-size-limit messaging from the interface.
- Increased interface text size and contrast across navigation, metadata, dialogs, and empty states.
- Reworked disconnected-state copy to use shorter, task-oriented language and clearer session actions.
- Rebalanced the desktop workspace to use wide displays more effectively without adding decorative panels.
- Rebuilt the file workspace around a functional dark navigation rail, sticky command bar, richer empty state, vault summary, sorting, and file-availability views.
- Added an in-product session setup dialog without exposing session values to browser storage or source files.
- Added loading skeletons so the interface no longer flashes a false empty state while the local index is loading.
- Added a required custom request marker for mutating local API calls as an additional browser-side CSRF barrier.
- Added deterministic file-view model tests for filtering, sorting, availability, and vault summaries.
- Added root `PRODUCT.md` and `DESIGN.md` documents to separate product truth from durable visual decisions.

## 0.3.0 - 2026-09-17

- Simplified Gemini session setup: release archives now include an empty `cookies.json` placeholder that is loaded automatically and minimized into private application data.

- Replaced the original interface with a restrained task-focused file workspace and fully English product copy.
- Split browser code into focused JavaScript and CSS modules instead of a monolithic frontend file.
- Split the local server into configuration, HTTP security, storage, recovery, provider URL, and API route modules.
- Removed unrelated response-format and artifact-generation code from the Gemini transport layer.
- Added loopback host validation, origin validation, no-store API responses, and stricter provider URL validation.
- Fixed JSON-file uploads being consumed by Express body parsing before the upload route could read the raw file stream.
- Added safe decoding for upload metadata and explicit UUID validation for file routes.
- Added bounded buffering for encrypted envelopes downloaded from Gemini.
- Introduced `cryox-vault-v2`, which authenticates vault metadata as AES-GCM associated data while preserving v1 read compatibility.
- Made first-use vault key creation atomic so concurrent processes cannot replace an existing key.
- Added stronger storage-marker validation and expanded regression tests.
- Added Windows CI coverage, dependency review, release checksums, and design-system documentation.
- Raised the supported runtime floor to maintained Node.js LTS releases and updated Express 4.x to 4.22.2.

## 0.2.0 - 2026-09-17

- Moved runtime state to a stable per-user application-data directory so fresh ZIP extractions retain the same vault state.
- Added automatic migration from the earlier project-local `data` and `gemini-threads` directories.
- Added account-history reconciliation that discovers Cryox-managed files across Gemini conversations while ignoring unrelated attachments.
- Added incremental history-scan state and bounded-concurrency reconciliation.
- Added persistent list-removal tombstones so intentionally hidden files are not re-imported on refresh.
- Expanded Gemini conversation reads for large Cryox storage histories.

## 0.1.0 - 2026-09-17

- Reworked the private prototype into a public-source repository layout.
- Removed embedded Google session credentials from source code.
- Replaced the fixed vault encryption key with a per-installation local key.
- Added a secure session import utility.
- Changed the default HTTP binding from all interfaces to loopback only.
- Added browser security headers and a restrictive Content Security Policy.
- Added secret scanning, syntax validation, and Node.js tests.
- Added CI, CodeQL, Dependabot, contribution guidance, and security documentation.
