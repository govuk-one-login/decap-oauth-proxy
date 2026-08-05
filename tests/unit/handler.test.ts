import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { auth, callback, setDeps, clearCache } from "../../src/handler.ts";
import type { Dependencies } from "../../src/handler.ts";

// Helper type for structured Lambda responses (not string responses)
interface StructuredResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

const TEST_CLIENT_ID = "test-client-id-123";
const TEST_CLIENT_SECRET = "test-client-secret-456";
const TEST_ALLOWED_ORIGIN = "https://docs.example.com";

// Set env before module evaluation
process.env["GITHUB_CLIENT_ID_PARAM"] = "/test/client-id";
process.env["GITHUB_CLIENT_SECRET_ARN"] = "test-secret-arn";
process.env["ALLOWED_ORIGINS"] = TEST_ALLOWED_ORIGIN;
process.env["GITHUB_AUTHORIZE_URL"] = "https://github.com/login/oauth/authorize";
process.env["GITHUB_TOKEN_URL"] = "https://github.com/login/oauth/access_token";

function makeMockDeps(fetchImpl?: typeof globalThis.fetch): Dependencies {
  const defaultFetch = async () =>
    new Response(JSON.stringify({ access_token: "gho_mock" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  return {
    ssmClient: { send: async () => ({ Parameter: { Value: TEST_CLIENT_ID } }) },
    secretsClient: { send: async () => ({ SecretString: TEST_CLIENT_SECRET }) },
    fetch: fetchImpl ?? defaultFetch,
  };
}

function makeValidState(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const random = crypto.randomBytes(16).toString("hex");
  const payload = `${timestamp}.${random}`;
  const hmac = crypto.createHmac("sha256", TEST_CLIENT_SECRET).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

function makeExpiredState(): string {
  const timestamp = Math.floor(Date.now() / 1000 - 600).toString(16);
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

function callbackEvent(code: string, state: string) {
  return {
    ...baseEvent,
    queryStringParameters: { provider: "github", code, state },
  } as unknown as Parameters<typeof callback>[0];
}

// --- /auth handler tests ---

describe("auth handler", () => {
  beforeEach(() => {
    clearCache();
    setDeps(makeMockDeps());
  });

  it("returns 302 redirect to GitHub authorize URL", async () => {
    const result = await auth(baseEvent);
    assert.equal((result as StructuredResult).statusCode, 302);
    const location = (result as StructuredResult).headers!["Location"]!;
    assert.match(location, /https:\/\/github\.com\/login\/oauth\/authorize/);
    assert.match(location, /client_id=test-client-id-123/);
    assert.match(location, /scope=repo%2Cuser/);
    assert.match(location, /state=/);
  });

  it("includes provider in callback redirect_uri", async () => {
    const result = await auth(baseEvent);
    const location = (result as StructuredResult).headers!["Location"]!;
    const url = new URL(location);
    const redirectUri = url.searchParams.get("redirect_uri")!;
    assert.match(redirectUri, /provider=github/);
  });

  it("sets Cache-Control: no-store", async () => {
    const result = await auth(baseEvent);
    const headers = (result as StructuredResult).headers!;
    assert.equal(headers["Cache-Control"], "no-store");
  });

  it("returns 400 for missing provider", async () => {
    const event = { ...baseEvent, queryStringParameters: {} } as unknown as Parameters<
      typeof auth
    >[0];
    const result = await auth(event);
    assert.equal((result as StructuredResult).statusCode, 400);
  });

  it("returns 400 for invalid provider", async () => {
    const event = {
      ...baseEvent,
      queryStringParameters: { provider: "gitlab" },
    } as unknown as Parameters<typeof auth>[0];
    const result = await auth(event);
    assert.equal((result as StructuredResult).statusCode, 400);
  });

  it("returns 500 when SSM fails", async () => {
    setDeps({
      ...makeMockDeps(),
      ssmClient: {
        send: async () => {
          throw new Error("SSM timeout");
        },
      },
    });
    const result = await auth(baseEvent);
    assert.equal((result as StructuredResult).statusCode, 500);
  });
});

// --- /callback handler tests ---

describe("callback handler", () => {
  beforeEach(() => {
    clearCache();
    setDeps(makeMockDeps());
  });

  it("exchanges code for token and returns HTML with handshake protocol", async () => {
    setDeps(
      makeMockDeps(
        async () =>
          new Response(JSON.stringify({ access_token: "gho_real_token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const result = await callback(callbackEvent("auth-code", makeValidState()));
    const body = (result as StructuredResult).body!;

    assert.equal((result as StructuredResult).statusCode, 200);
    // Handshake: posts "authorizing:" + provider to opener
    assert.match(body, /postMessage\("authorizing:" \+ provider/);
    // Result: posts "authorization:" + provider + ":success:" + payload
    assert.match(body, /authorization:" \+ provider \+ ":" \+ status \+ ":" \+ payload/);
    assert.match(body, /gho_real_token/);
    assert.match(body, /window\.addEventListener\("message"/);
  });

  it("restricts postMessage origin to allowed origin", async () => {
    const result = await callback(callbackEvent("code", makeValidState()));
    const body = (result as StructuredResult).body!;
    // Origin should appear as a JS string value in the HTML
    assert.match(body, /var origin = "https:\/\/docs\.example\.com"/);
    assert.ok(!body.includes('"*"'));
  });

  it("returns error for missing provider", async () => {
    const event = {
      ...baseEvent,
      queryStringParameters: { code: "x", state: "y" },
    } as unknown as Parameters<typeof callback>[0];
    const result = await callback(event);
    const body = (result as StructuredResult).body!;
    assert.match(body, /Invalid or missing provider/);
  });

  it("returns error when code is missing", async () => {
    const event = {
      ...baseEvent,
      queryStringParameters: { provider: "github", state: "x" },
    } as unknown as Parameters<typeof callback>[0];
    const result = await callback(event);
    const body = (result as StructuredResult).body!;
    assert.match(body, /Missing authorization code/);
  });

  it("returns error when state is missing", async () => {
    const event = {
      ...baseEvent,
      queryStringParameters: { provider: "github", code: "x" },
    } as unknown as Parameters<typeof callback>[0];
    const result = await callback(event);
    const body = (result as StructuredResult).body!;
    assert.match(body, /Missing state parameter/);
  });

  it("returns error when state HMAC is invalid", async () => {
    const state = makeValidState();
    const parts = state.split(".");
    const fakeHmac = crypto.randomBytes(32).toString("hex");
    const tampered = `${parts[0]}.${parts[1]}.${fakeHmac}`;

    const result = await callback(callbackEvent("code", tampered));
    const body = (result as StructuredResult).body!;
    assert.match(body, /Invalid or expired/);
  });

  it("returns error when state is expired", async () => {
    const result = await callback(callbackEvent("code", makeExpiredState()));
    const body = (result as StructuredResult).body!;
    assert.match(body, /Invalid or expired/);
  });

  it("returns error when token exchange HTTP fails", async () => {
    setDeps(makeMockDeps(async () => new Response("error", { status: 500 })));
    const result = await callback(callbackEvent("code", makeValidState()));
    const body = (result as StructuredResult).body!;
    assert.match(body, /Failed to exchange/);
  });

  it("returns error when GitHub returns OAuth error", async () => {
    setDeps(
      makeMockDeps(
        async () =>
          new Response(
            JSON.stringify({ error: "bad_verification_code", error_description: "Code expired" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const result = await callback(callbackEvent("bad", makeValidState()));
    const body = (result as StructuredResult).body!;
    assert.match(body, /Code expired/);
  });
});
