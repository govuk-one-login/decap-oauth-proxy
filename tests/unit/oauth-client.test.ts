import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OAuthClient, OAuthTokenError } from "../../src/oauth-client.ts";
import { Provider } from "../../src/config.ts";

const CLIENT_CONFIG = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
};

describe("OAuthClient.authorizeUrl", () => {
  it("builds a valid authorization URL with query params", () => {
    const client = new OAuthClient(CLIENT_CONFIG);
    const url = client.authorizeUrl({
      redirectUri: "https://proxy.example.com/callback?provider=github",
      scope: "repo,user",
      state: "abc123",
      provider: Provider.GitHub,
    });

    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(parsed.searchParams.get("client_id"), "test-client-id");
    assert.equal(parsed.searchParams.get("scope"), "repo,user");
    assert.equal(parsed.searchParams.get("state"), "abc123");
    assert.equal(
      parsed.searchParams.get("redirect_uri"),
      "https://proxy.example.com/callback?provider=github",
    );
  });
});

describe("OAuthClient.exchangeCode", () => {
  it("sends correct payload and returns parsed token response", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ access_token: "gho_test_token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new OAuthClient(CLIENT_CONFIG, mockFetch as typeof fetch);
    const result = await client.exchangeCode("auth-code-xyz");

    assert.equal(capturedUrl, "https://github.com/login/oauth/access_token");
    const body = JSON.parse(capturedBody) as Record<string, string>;
    assert.equal(body["client_id"], "test-client-id");
    assert.equal(body["client_secret"], "test-client-secret");
    assert.equal(body["code"], "auth-code-xyz");
    assert.equal(result.access_token, "gho_test_token");
  });

  it("throws OAuthTokenError when HTTP response is not ok", async () => {
    const mockFetch = async () => new Response("Internal Server Error", { status: 500 });

    const client = new OAuthClient(CLIENT_CONFIG, mockFetch as typeof fetch);

    await assert.rejects(
      () => client.exchangeCode("bad-code"),
      (err: Error) => {
        assert.ok(err instanceof OAuthTokenError);
        assert.match(err.message, /HTTP 500/);
        return true;
      },
    );
  });

  it("returns error fields from GitHub without throwing", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const client = new OAuthClient(CLIENT_CONFIG, mockFetch as typeof fetch);
    const result = await client.exchangeCode("expired-code");

    assert.equal(result.error, "bad_verification_code");
    assert.equal(result.error_description, "The code passed is incorrect or expired");
    assert.equal(result.access_token, undefined);
  });
});
