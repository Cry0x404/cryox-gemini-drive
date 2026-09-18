[![CI](https://github.com/Cry0x404/cryox-gemini-drive/actions/workflows/ci.yml/badge.svg)](https://github.com/Cry0x404/cryox-gemini-drive/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Cry0x404/cryox-gemini-drive/actions/workflows/codeql.yml/badge.svg)](https://github.com/Cry0x404/cryox-gemini-drive/actions/workflows/codeql.yml)
![Node](https://img.shields.io/badge/node-22%2B-111111)
![License](https://img.shields.io/badge/license-MIT-111111)
![Status](https://img.shields.io/badge/status-alpha-8a5b2f)

# Cryox Gemini Drive

Cryox Gemini Drive is a local encrypted file vault backed by a persistent Gemini Web conversation. Plaintext uploads are processed in memory, wrapped in an authenticated encrypted envelope, mirrored locally in encrypted form, and associated with a Cryox-only marker in Gemini history for recovery.

> [!IMPORTANT]
> This project uses an unofficial Gemini Web transport and is not affiliated with or endorsed by Google. Private web endpoints can change without notice.

## What it does

- Encrypts uploaded files with AES-256-GCM before provider storage.
- Keeps only encrypted vault envelopes in the local download mirror.
- Recovers Cryox-managed records from Gemini history after source ZIP replacement or relocation.
- Ignores ordinary Gemini attachments that do not contain the Cryox storage marker.
- Keeps vault keys, indexes, encrypted mirrors, and provider continuation state outside the source tree; the local cookie export is isolated in ignored `cookies.json`.
- Binds the local server to `127.0.0.1` by default and applies browser hardening headers.

## Requirements

- Node.js 22 or newer
- A Gemini Web session belonging to the user running the application

## Installation

```bash
git clone https://github.com/Cry0x404/cryox-gemini-drive.git
cd cryox-gemini-drive
npm install
```

Windows users can also extract a release archive and run `START.bat`.

## Session setup

A blank `cookies.json` is included in release archives. Export your Gemini browser cookies as JSON, replace the contents of `cookies.json` with the complete export, save the file, and start the application. No import command is required.

The export must include `__Secure-1PSID` and `__Secure-1PSIDTS`. When a valid export is detected, Cryox Drive also keeps a minimized private session copy in the platform application-data directory so replacing the source ZIP does not require another import step.

Environment variables remain available for advanced setups:

```text
CRYOX_GEMINI_PSID
CRYOX_GEMINI_PSIDTS
```

`cookies.json` is excluded by `.gitignore`. Do not force-add it, commit it, share it, or include it in screenshots. A browser session cookie is an account credential.

## Run

```bash
npm start
```

Open `http://127.0.0.1:3000`.

For development:

```bash
npm run dev
```

## Storage model

```text
Browser upload
    |
    v
In-memory plaintext
    |
    v
AES-256-GCM vault envelope
    |                    \
    |                     +--> local encrypted mirror
    v
Gemini attachment upload
    |
    v
Persistent Cryox storage marker
```

New uploads use `cryox-vault-v2`. File metadata is authenticated as AES-GCM associated data, so changing the stored name, type, size, digest, or IV invalidates decryption. Existing v1 envelopes remain readable.

## Persistent state and recovery

Cryox stores private runtime state outside the extracted source directory. The default locations are:

- Windows: `%LOCALAPPDATA%\Cryox\GeminiDrive`
- macOS: `~/Library/Application Support/Cryox Gemini Drive`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/cryox-gemini-drive`

After a valid `cookies.json` has been detected once, replacing the source ZIP does not reset the minimized local session, vault key, index, encrypted mirror, scan state, or Gemini continuation metadata.

On startup, the application reconciles the local index with Gemini history. It imports only messages containing `[CRYOX_GEMINI_DRIVE_FILE_V1]`; unrelated conversations and attachments are ignored. Manual **Sync** performs a forced reconciliation across the available conversation list.

Pre-0.2 project-local state is copied into the persistent store only when the corresponding persistent file does not already exist. Migration does not delete the original files.

## Local security boundaries

The public repository contains no live Google session cookies and no fixed vault key. Release archives contain only an empty `cookies.json` placeholder.

- A unique 256-bit vault key is created atomically on first use.
- Credential and key files are written with restrictive permissions where the platform supports them.
- The local API rejects non-loopback Host and Origin values when the server is using its default loopback binding.
- Provider download URLs are restricted to approved HTTPS Google hosts.
- API responses are marked `no-store`.
- The interface uses a restrictive Content Security Policy and disables framing.

Read `docs/security.md` before changing `HOST` or exposing the service through a proxy.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address | `127.0.0.1` |
| `CRYOX_STORAGE_ROOT` | Root for local runtime state | platform application-data directory |
| `CRYOX_GEMINI_COOKIE_FILE` | Browser cookie export location | `<project>/cookies.json` |
| `CRYOX_GEMINI_SESSION_FILE` | Minimized private session location | `<storage-root>/data/gemini-session.json` |
| `CRYOX_VAULT_KEY_FILE` | Vault key location | `<storage-root>/data/vault.key` |
| `CRYOX_VAULT_KEY_HEX` | Optional 64-character hex key override | unset |

## Repository layout

```text
public/                 Browser interface
  js/                   API, file-list, upload, formatting, and app modules
  styles/               Tokens, shell, file surface, overlays, and responsive rules
src/
  http/                 Request guards, headers, and validation
  routes/               Local API routes
  services/             Gemini history and trusted provider URL handling
  store/                Local vault index, tombstones, state, and encrypted mirror
lib/                    Gemini transport, session handling, and vault cryptography
scripts/                Validation utilities
test/                   Node.js regression tests
docs/                   Architecture, security, authentication, and interface system
```

## Validation

```bash
npm run verify
```

The verification path performs JavaScript syntax validation, a repository-level secret scan, and the Node.js regression suite. GitHub Actions additionally runs the suite on Node 22 and 24 on Linux and Node 24 on Windows. CodeQL and dependency review run separately.

## Project status

Cryox Gemini Drive is alpha software. The provider protocol layer is intentionally isolated because Gemini Web is an undocumented upstream interface.

See `docs/architecture.md`, `docs/authentication.md`, `docs/security.md`, and `docs/design-system.md` for implementation details.

## Contributing

Read `CONTRIBUTING.md` before opening a pull request. Security-sensitive reports must follow `SECURITY.md` and must not contain live account credentials or private provider URLs.

## License

MIT. See `LICENSE`.
