# decap-oauth-proxy

GitHub OAuth proxy for [Decap CMS](https://decapcms.org/).

Handles the server-side OAuth token exchange required by GitHub for Decap CMS authentication. Designed to be shared across multiple docs-as-code sites.

## Why

Decap CMS needs a GitHub access token to make API calls on behalf of the user. GitHub's OAuth token exchange endpoint requires a `client_secret`, which cannot be safely held in a browser-based application. This proxy performs the token exchange server-side.

See the [GitHub PKCE announcement (July 2025)](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/) — PKCE is now supported but `client_secret` remains mandatory on the token exchange.

## Stack

- AWS Lambda (Node.js 24) + API Gateway (HTTP API)
- CloudFormation for infrastructure
- `node:test` for testing (zero external test framework dependencies)
- [Imposter](https://www.imposter.sh/) for integration testing

## Status

🚧 Under development
