import type { Provider } from "./config.ts";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
}

export interface AuthorizeOptions {
  redirectUri: string;
  scope: string;
  state: string;
  provider: Provider;
}

export interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Minimal OAuth client that handles:
 * 1. Constructing the authorization URL for the redirect
 * 2. Exchanging an authorization code for an access token
 *
 * Extracted as a class for clarity and testability. The fetch
 * function is injected to allow mocking in tests.
 */
export class OAuthClient {
  private readonly config: OAuthClientConfig;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: OAuthClientConfig, fetchFn?: typeof globalThis.fetch) {
    this.config = config;
    this.fetch = fetchFn ?? globalThis.fetch;
  }

  /**
   * Build the full GitHub OAuth authorization URL.
   */
  authorizeUrl(options: AuthorizeOptions): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: options.redirectUri,
      scope: options.scope,
      state: options.state,
    });
    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for an access token.
   * Returns the parsed JSON response from GitHub's token endpoint.
   */
  async exchangeCode(code: string): Promise<TokenResponse> {
    const response = await this.fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      throw new OAuthTokenError(`Token exchange failed with HTTP ${response.status.toString()}`);
    }

    return (await response.json()) as TokenResponse;
  }
}

export class OAuthTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthTokenError";
  }
}
