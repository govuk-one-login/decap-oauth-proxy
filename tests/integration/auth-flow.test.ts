/**
 * Integration tests for the OAuth proxy.
 *
 * These tests run the Lambda handler against an imposter mock of GitHub's
 * OAuth endpoints. Start imposter before running:
 *
 *   docker compose up -d
 *   npm run test:integration
 *   docker compose down
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { auth, callback, setDeps, clearCache } from "../../src/handler.ts";
import type { Dependencies } from "../../src/handler.ts";

const IMPOSTER_BASE = process.env["IMPOSTER_URL"] || "http://localhost:8080";
const TEST_CLIENT_ID = "integration-test-client-id";
const TEST_CLIENT_SECRET = "integration-test-client-secret";
const TEST_ALLOWED_ORIGIN = "https://docs.example.com";

// Point the handler at imposter instead of real GitHub
process.env["GITHUB_AUTHORIZE_URL"] = `${IMPOSTER_BASE}/login/oauth/authorize`;
process.env["GITHUB_TOKEN_URL"] = `${IMPOSTER_BASE}/login/oauth/access_token`;
process.env["GITHUB_CLIENT_ID_PARAM"] = "/decap-oauth/test/github-client-id";
process.env["GITHUB_CLIENT_SECRET_ARN"] = "test-secret-arn";
process.env["ALLOWED_ORIGINS"] = TEST_ALLOWED_ORIGIN;

// --- Setup ---

before(async () => {
  try {
    const res = await fetch(`${IMPOSTER_BASE}/system/status`);
    if (!res.ok) throw new Error(`Imposter returned ${res.status.toString()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(
      `Cannot reach imposter at ${IMPOSTER_BASE}. Start it with: docker compose up -d\n${message}`,
    );
  }
});

beforeEach(() => {
  clearCache();
  const deps: Partial<Dependencies> = {
    ssmClient: {
      send: async () => ({ Parameter: { Value: TEST_CLIENT_ID } }),
    },
    secretsClient: {
      send: async () => ({ SecretString: TEST_CLIENT_SECRET }),
    },
    fetch: globalThis.fetch,
  };
  setDeps(deps);
});

// --- Helpers ---

interface StructuredResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

function makeValidState(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const random = crypto.randomBytes(16).toString("hex");
  const payload = `${timestamp}.${random}`;
  const hmac = crypto.createHmac("sha256", TEST_CLIENT_SECRET).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

const baseEvent = {
  headers: { host: "cms-auth.example.com" },
  requestContext: { domainName: "cms-auth.example.com", stage: "$default" },
  queryStringParameters: { provider: "github" },
} as unknown as Parameters<typeof auth>[0];

// --- Tests ---

describe("integration: full OAuth flow against imposter", () => {
  it("/auth redirects to GitHub (imposter) authorize URL", async () => {
    const result = (await auth(baseEvent)) as StructuredResult;

    assert.equal(result.statusCode, 302);
    assert.match(result.headers!["Location"]!, new RegExp(IMPOSTER_BASE));
    assert.match(result.headers!["Location"]!, /client_id=integration-test-client-id/);
  });

  it("full round-trip: /auth redirect → follow → /callback → token", async () => {
    // Step 1: Call /auth, get redirect URL
    const authResult = (await auth(baseEvent)) as StructuredResult;
    assert.equal(authResult.statusCode, 302);

    const redirectUrl = new URL(authResult.headers!["Location"]!);
    const state = redirectUrl.searchParams.get("state");
    assert.ok(state, "state parameter should be present");

    // Step 2: Follow the redirect to imposter (simulates GitHub authorize)
    const githubResponse = await fetch(authResult.headers!["Location"]!, { redirect: "manual" });
    assert.equal(githubResponse.status, 302);

    const callbackUrl = new URL(githubResponse.headers.get("location")!);
    const code = callbackUrl.searchParams.get("code");
    const returnedState = callbackUrl.searchParams.get("state");

    assert.equal(code, "mock-auth-code-12345");
    assert.equal(returnedState, state, "state should round-trip unchanged");

    // Step 3: Call /callback with the code and state
    const callbackResult = (await callback({
      ...baseEvent,
      queryStringParameters: { provider: "github", code: code!, state: returnedState! },
    } as unknown as Parameters<typeof callback>[0])) as StructuredResult;

    assert.equal(callbackResult.statusCode, 200);
    // Check the handshake protocol is present
    assert.match(callbackResult.body!, /postMessage\("authorizing:" \+ provider/);
    // Check the token made it through
    assert.match(callbackResult.body!, /gho_mock_token_mock-auth-code-12345/);
    // Check origin is restricted
    assert.match(callbackResult.body!, new RegExp(TEST_ALLOWED_ORIGIN.replace(/\./g, "\\.")));
  });

  it("/callback handles expired code from GitHub", async () => {
    const state = makeValidState();

    const result = (await callback({
      ...baseEvent,
      queryStringParameters: { provider: "github", code: "expired-code", state },
    } as unknown as Parameters<typeof callback>[0])) as StructuredResult;

    assert.equal(result.statusCode, 200);
    assert.match(result.body!, /authorization:.*error/);
    assert.match(result.body!, /incorrect or expired/);
  });

  it("/callback rejects tampered state even with valid code", async () => {
    const state = makeValidState();
    const tampered = "bad." + state.split(".").slice(1).join(".");

    const result = (await callback({
      ...baseEvent,
      queryStringParameters: { provider: "github", code: "mock-auth-code-12345", state: tampered },
    } as unknown as Parameters<typeof callback>[0])) as StructuredResult;

    assert.match(result.body!, /Invalid or expired/);
  });
});
