# Architecture

Cryox Gemini Drive separates the local product surface from provider transport, persistence, and cryptography.

## Boundaries

1. `server.js` is the process entry point. It creates the application and starts the loopback HTTP listener.
2. `src/app.js` assembles HTTP security middleware, the API router, and static browser assets.
3. `src/http/` contains request-origin and Host validation plus request metadata validation.
4. `src/routes/api.js` defines the local vault API and orchestrates uploads, downloads, deletion, status, and reconciliation requests.
5. `src/store/vault-store.js` owns local JSON state, tombstones, and the encrypted mirror.
6. `src/services/history.js` owns Gemini history reconciliation and persistence verification.
7. `src/services/provider-urls.js` validates provider download URLs before they are fetched.
8. `lib/gemini-web.js` isolates the unofficial Gemini Web protocol, provider session refresh, upload transport, chat history, and model discovery.
9. `lib/vault-envelope.js` owns encrypted envelope creation and authenticated decryption.
10. `public/` contains the browser UI and communicates only with the local `/api/*` surface.

## Upload path

The browser sends the file bytes directly to `POST /api/upload` with file metadata in bounded headers. No generic JSON body parser is installed on the upload path, so JSON documents and other MIME types are handled as raw file streams.

The route validates the declared size and metadata, reads the bounded upload into memory, encrypts it using the local vault key, writes only the encrypted envelope to the local mirror, uploads that envelope to Gemini, and saves the local record only after the provider conversation marker is verified.

## Vault envelope

`cryox-vault-v2` encrypts the file payload with AES-256-GCM. The canonical metadata fields are supplied as authenticated associated data. This binds the encrypted bytes to the stored file name, MIME type, size, digest, and IV.

The reader retains support for `cryox-vault-v1` to avoid invalidating existing local encrypted mirrors.

## Download path

The server first attempts a trusted provider-hosted HTTPS URL when one is available. Provider URLs are restricted to known Google attachment host families and reject embedded credentials or unexpected ports.

Encrypted provider responses are read with a hard upper bound before decryption. If the provider exposes only an opaque handle, the local encrypted mirror is authenticated and decrypted in memory. Plaintext is written directly to the HTTP response and is not persisted to disk.

## Recovery and reconciliation

Runtime state lives in the platform application-data directory rather than beside the source tree. The server incrementally scans Gemini conversations that are new or changed since the previous successful reconciliation. When the local index is empty it performs a full recovery scan.

Only messages containing the Cryox storage marker and a structurally valid vault record are considered. Removed file IDs are persisted as tombstones so a later history scan does not silently restore them.

## Browser interface

The frontend is intentionally dependency-free. `public/js/` separates API transport, file rendering, upload orchestration, formatting, icons, and application bootstrap. `public/styles/` separates tokens, base rules, shell layout, file-specific styles, overlays, and responsive behavior.
