# decap-oauth-proxy

GitHub OAuth proxy for [Decap CMS](https://decapcms.org/).

Handles the server-side OAuth token exchange required by GitHub for Decap CMS authentication. Designed to be shared across multiple docs-as-code sites.

## Why

Decap CMS needs a GitHub access token to make API calls on behalf of the user. GitHub's OAuth token exchange endpoint requires a `client_secret`, which cannot be safely held in a browser-based application. This proxy performs the token exchange server-side.

See the [GitHub PKCE announcement (July 2025)](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/) — PKCE is now supported but `client_secret` remains mandatory on the token exchange.

## Stack

- AWS Lambda (Node.js 24) + API Gateway (HTTP API)
- TypeScript (strict, ESM) with esbuild bundling
- CloudFormation for infrastructure
- `node:test` via tsx (zero external test framework)
- [Imposter](https://www.imposter.sh/) for integration testing
- Express dev server for local browser testing

## Getting started

```bash
nvm use          # picks up .nvmrc (Node 24)
npm install
npm test         # 27 unit tests
npm run lint     # eslint + prettier
npm run test:types  # tsc --noEmit
```

## Running locally

The dev server wraps the Lambda handlers in Express, so you can test the full OAuth popup flow in a browser without deploying to AWS.

### With a real GitHub OAuth App

1. [Register a GitHub OAuth App](https://github.com/settings/applications/new) with callback URL `http://localhost:3000/callback?provider=github`
2. Run the server:

```bash
GITHUB_CLIENT_ID=your_client_id \
GITHUB_CLIENT_SECRET=your_client_secret \
ALLOWED_ORIGINS=http://localhost:4567 \
npm run dev:mock
```

3. Configure your Decap CMS `config.yml`:

```yaml
backend:
  name: github
  repo: your-org/your-repo
  branch: main
  base_url: http://localhost:3000
  auth_endpoint: auth
```

4. Open the CMS admin page — "Login with GitHub" will use your local proxy.

### Mock mode (no GitHub)

`npm run dev:mock` with no credentials will start the server with placeholder values — useful for testing the redirect flow without a real OAuth App.

## Testing

### Unit tests

```bash
npm test
```

Uses Node.js built-in test runner (`node:test`) via tsx. Tests cover:
- HMAC state generation and validation
- OAuthClient URL construction and token exchange
- Both Lambda handlers (auth + callback)
- Provider validation, error paths, Decap handshake protocol

### Integration tests

```bash
docker compose up -d        # start imposter (mocks GitHub OAuth)
npm run test:integration
docker compose down
```

Exercises the full OAuth round-trip against an [imposter](https://www.imposter.sh/) mock of GitHub's OAuth endpoints. Tests the real HTTP boundary between our handler and GitHub's API contract.

### Type checking and linting

```bash
npm run test:types    # tsc --noEmit
npm run lint          # eslint (typescript-eslint strict + prettier)
npm run lint:fix      # auto-fix formatting
```

## Building

```bash
npm run build
```

Bundles `src/handler.ts` into `dist/handler.mjs` via esbuild. AWS SDK is externalized (Lambda provides it at runtime).

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full deployment approach, environment model, and alternatives considered.

## Status

🚧 Under development
