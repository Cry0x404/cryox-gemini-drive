# Product

## Platform

Web interface served by a local Node.js application.

## Audience

People who want a local file-management interface that stores encrypted file envelopes through their own Gemini Web session.

## Primary job

Upload, find, recover, and download encrypted files without exposing plaintext files or account credentials in the public source tree.

## Core workflows

- Import a Gemini Web browser session locally.
- Upload one or more files through the connected Gemini Web session.
- Search, filter, sort, and download vault records.
- Reconcile the local index with marked Cryox records in Gemini conversation history.
- Remove a local vault record without deleting the historical Gemini attachment.

## Product constraints

- The service is local-only by default.
- Gemini Web is an undocumented upstream transport and can change independently of this project.
- Session cookies are account credentials and must not be displayed or committed.
- Upload plaintext exists only in process memory before encryption.
- Persistent local mirrors contain encrypted vault envelopes.
- Ordinary Gemini attachments are outside the vault and must not be imported.

## Voice

Direct, technical, calm, and concise. Prefer concrete actions and system behavior over marketing language.
