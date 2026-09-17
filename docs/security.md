# Security model

Cryox Gemini Drive protects local credentials and uploaded file contents, but it is not a replacement for an audited cloud-storage product. The Gemini transport relies on undocumented web interfaces and should be treated as a compatibility risk.

## Credentials

Gemini browser session cookies are account credentials. The repository and release archives contain an empty `cookies.json` placeholder in the project root. A user can paste a browser cookie export into that file for local use. The committed placeholder must remain `[]`; never commit a populated export.

Only `__Secure-1PSID` and `__Secure-1PSIDTS` are retained in the minimized private session copy written to the application-data directory. Cookie values are never returned through the browser API or printed by the application.

If a populated `cookies.json` or private session file is exposed, rotate the browser session before sharing logs or reproductions.

## Vault key

A random 256-bit key is created on first use and stored outside the repository. Key creation uses exclusive file creation so a second process cannot overwrite an already-created key during startup.

If the key is lost, encrypted local mirrors and encrypted Gemini attachments created with that key cannot be decrypted. Back up the key only if you understand the security implications.

## Encryption

New vaults use AES-256-GCM with a unique 96-bit IV per file. `cryox-vault-v2` authenticates canonical metadata as associated data and validates the decrypted size and SHA-256 digest. The reader also supports the earlier v1 envelope format for compatibility.

Plaintext uploads are buffered in memory for encryption and are not intentionally written to disk. The local mirror contains encrypted vault archives only.

## Local HTTP boundary

The server binds to `127.0.0.1` by default. When running on a loopback host, the HTTP layer rejects non-loopback Host and Origin values. This reduces exposure to cross-origin local-service attacks and accidental DNS-rebinding style access.

The browser surface also applies a restrictive Content Security Policy, denies framing, disables MIME sniffing, disables DNS prefetching, and marks API responses as `no-store`.

Changing `HOST` to a non-loopback address removes the loopback-only request guard by design. Do not expose the service directly to an untrusted network. Put an authenticated reverse proxy in front of it if remote access is required.

## Provider downloads

Download URLs discovered in Gemini responses are accepted only when they use HTTPS, contain no embedded credentials, use the default HTTPS port, and match approved Google attachment host families. Encrypted provider responses are bounded before being materialized in memory.

## Repository hygiene

`.gitignore` excludes runtime data, cookie exports, session files, credentials, private keys, vault keys, encrypted mirror files, and local design-tool state. `npm run check` includes a secret scanner for common accidental credential patterns.

The scanner is a defense-in-depth check, not a guarantee. Review staged changes before every public push.
