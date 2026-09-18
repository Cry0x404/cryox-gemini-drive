# Contributing

## Development setup

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Run `npm run check` and `npm test` before opening a pull request.

Do not commit live browser cookies, vault keys, private provider handles, local runtime state, or captured account traffic.

## Pull requests

Keep changes focused and explain protocol changes with evidence. For changes to the Gemini Web transport, separate parsing changes from UI changes where practical and add regression tests for pure parsing or validation logic.

## Licensing of contributions

Unless explicitly agreed otherwise before submission, contributions are accepted under `GPL-3.0-only`. By submitting a contribution, you represent that you have the right to license it under those terms.

## Commit style

Use concise imperative commit messages such as `Harden local session loading` or `Add vault integrity regression tests`.
