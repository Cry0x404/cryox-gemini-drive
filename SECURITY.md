# Security Policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch.

## Reporting a vulnerability

Do not open a public issue containing session cookies, provider tokens, private keys, vault keys, private download URLs, or account identifiers.

Report the issue privately to the repository owner and include only the minimum reproduction material required. Rotate any credential that may have been exposed before sharing logs or diagnostics.

## Credential handling

Gemini browser cookies are account credentials. Runtime session material, vault keys, indexes, encrypted mirrors, and provider continuation metadata live outside the source tree by default and must remain private.

## Local network exposure

The supported default is loopback-only operation. Setting `HOST` to a non-loopback address changes the threat model and should be done only behind an authentication layer appropriate for the deployment.

## Scope

The project relies on unofficial Gemini Web interfaces. Upstream protocol changes are compatibility issues unless they create a concrete confidentiality, integrity, or authentication impact in this project.
