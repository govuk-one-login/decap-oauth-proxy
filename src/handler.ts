import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { config, isValidProvider, Provider } from "./config.ts";
import type { LambdaEvent, LambdaResult } from "./config.ts";
import { generateState, validateState } from "./state.ts";
import { OAuthClient, OAuthTokenError } from "./oauth-client.ts";
import { successResponse, errorResponse } from "./responses.ts";

// --- Dependency injection for testability ---

export interface Dependencies {
  ssmClient: { send: (cmd: unknown) => Promise<{ Parameter?: { Value?: string } }> };
  secretsClient: { send: (cmd: unknown) => Promise<{ SecretString?: string }> };
  fetch: typeof globalThis.fetch;
}

const defaultDeps: Dependencies = {
  ssmClient: new SSMClient() as unknown as Dependencies["ssmClient"],
  secretsClient: new SecretsManagerClient() as unknown as Dependencies["secretsClient"],
  fetch: globalThis.fetch,
};

let deps: Dependencies = defaultDeps;

export function setDeps(overrides: Partial<Dependencies> | undefined): void {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
}

// --- Credential caching (warm Lambda optimisation) ---

let cachedClientId: string | null = null;
let cachedClientSecret: string | null = null;

export function clearCache(): void {
  cachedClientId = null;
  cachedClientSecret = null;
}

async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;
  const response = await deps.ssmClient.send(
    new GetParameterCommand({ Name: config.clientIdParam }),
  );
  cachedClientId = response.Parameter?.Value ?? "";
  return cachedClientId;
}

async function getClientSecret(): Promise<string> {
  if (cachedClientSecret) return cachedClientSecret;
  const response = await deps.secretsClient.send(
    new GetSecretValueCommand({ SecretId: config.clientSecretArn }),
  );
  cachedClientSecret = response.SecretString ?? "";
  return cachedClientSecret;
}

// --- Helpers ---

function resolveOrigin(): string {
  return config.allowedOrigins[0] ?? "";
}

function buildCallbackUrl(event: LambdaEvent, provider: Provider): string {
  const host = event.headers?.["host"] ?? event.requestContext?.domainName ?? "";
  const stage = event.requestContext?.stage;
  const base = stage && stage !== "$default" ? `https://${host}/${stage}` : `https://${host}`;
  return `${base}/callback?provider=${provider}`;
}

// --- Lambda handlers ---

/**
 * GET /auth?provider=github
 * Validates the provider, generates state, redirects to GitHub authorize.
 */
export async function auth(event: LambdaEvent): Promise<LambdaResult> {
  try {
    const provider = event.queryStringParameters?.["provider"];

    if (!isValidProvider(provider)) {
      return { statusCode: 400, body: "Invalid or missing provider parameter" };
    }

    const clientId = await getClientId();
    const clientSecret = await getClientSecret();
    const state = generateState(clientSecret);

    const oauth = new OAuthClient(
      {
        clientId,
        clientSecret,
        authorizeUrl: config.githubAuthorizeUrl,
        tokenUrl: config.githubTokenUrl,
      },
      deps.fetch,
    );

    const authorizeUrl = oauth.authorizeUrl({
      redirectUri: buildCallbackUrl(event, provider),
      scope: config.oauthScopes,
      state,
      provider,
    });

    return {
      statusCode: 302,
      headers: { Location: authorizeUrl, "Cache-Control": "no-store" },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in auth handler:", message);
    return { statusCode: 500, body: "Internal server error during authentication setup" };
  }
}

/**
 * GET /callback?provider=github&code=XXX&state=YYY
 * Validates state, exchanges code for token, returns Decap postMessage HTML.
 */
export async function callback(event: LambdaEvent): Promise<LambdaResult> {
  const provider = event.queryStringParameters?.["provider"];
  const targetOrigin = resolveOrigin();
  const safeProvider: Provider = isValidProvider(provider) ? provider : Provider.GitHub;

  try {
    if (!isValidProvider(provider)) {
      return errorResponse("Invalid or missing provider parameter", safeProvider, targetOrigin);
    }

    const code = event.queryStringParameters?.["code"];
    const state = event.queryStringParameters?.["state"];

    if (!code) {
      return errorResponse("Missing authorization code", provider, targetOrigin);
    }

    if (!state) {
      return errorResponse("Missing state parameter", provider, targetOrigin);
    }

    const clientSecret = await getClientSecret();

    if (!validateState(state, clientSecret)) {
      console.warn("Invalid or expired state parameter");
      return errorResponse(
        "Invalid or expired authentication session. Please try again.",
        provider,
        targetOrigin,
      );
    }

    const clientId = await getClientId();

    const oauth = new OAuthClient(
      {
        clientId,
        clientSecret,
        authorizeUrl: config.githubAuthorizeUrl,
        tokenUrl: config.githubTokenUrl,
      },
      deps.fetch,
    );

    const tokenData = await oauth.exchangeCode(code);

    if (tokenData.error) {
      console.error("GitHub OAuth error:", tokenData.error, tokenData.error_description);
      return errorResponse(
        `GitHub authentication error: ${tokenData.error_description ?? tokenData.error}`,
        provider,
        targetOrigin,
      );
    }

    const token = tokenData.access_token;
    if (!token) {
      console.error("No access_token in GitHub response");
      return errorResponse("No access token received from GitHub", provider, targetOrigin);
    }

    return successResponse(token, provider, targetOrigin);
  } catch (error) {
    if (error instanceof OAuthTokenError) {
      console.error("Token exchange failed:", error.message);
      return errorResponse("Failed to exchange authorization code", safeProvider, targetOrigin);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in callback handler:", message);
    return errorResponse("Internal server error during token exchange", safeProvider, targetOrigin);
  }
}
