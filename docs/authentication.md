# Authentication

Cryox Gemini Drive uses the current user's Gemini Web browser session. It does not ship an OAuth client, service account, or Google API key.

## Session input

The transport requires these two cookies:

- `__Secure-1PSID`
- `__Secure-1PSIDTS`

Release archives include an empty `cookies.json` in the project root. Export Gemini cookies as JSON, replace the contents of that file with the complete browser export, save it, and start the application. No import command is required.

When `cookies.json` contains both required values, Cryox Drive uses them immediately and writes a minimized private copy to the application-data directory. The committed `cookies.json` placeholder must remain empty. A populated local export must never be committed.

`CRYOX_GEMINI_PSID` and `CRYOX_GEMINI_PSIDTS` remain available as advanced environment-variable overrides.

## Session lifetime

Google can expire or rotate browser sessions at any time. A configured session can therefore exist locally while no longer being accepted by Gemini. The UI distinguishes an unconfigured session from a configured session that currently fails provider verification.

## Security guidance

Never commit, force-add, upload, or share a populated `cookies.json`. Treat browser session cookies with the same care as a password and rotate the session if exposure is suspected.
