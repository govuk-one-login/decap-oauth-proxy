import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

export interface Config {
  githubAuthorizeUrl: string;
  githubTokenUrl: string;
  oauthScopes: string;
  stateTtlSeconds: number;
  allowedOrigins: string[];
  clientIdParam: string;
  clientSecretArn: string;
}

export const config: Config = {
  githubAuthorizeUrl:
    process.env["GITHUB_AUTHORIZE_URL"] ?? "https://github.com/login/oauth/authorize",
  githubTokenUrl: process.env["GITHUB_TOKEN_URL"] ?? "https://github.com/login/oauth/access_token",
  oauthScopes: process.env["OAUTH_SCOPES"] ?? "repo,user",
  stateTtlSeconds: parseInt(process.env["STATE_TTL_SECONDS"] ?? "300", 10),
  get allowedOrigins(): string[] {
    return (process.env["ALLOWED_ORIGINS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get clientIdParam(): string {
    return process.env["GITHUB_CLIENT_ID_PARAM"] ?? "";
  },
  get clientSecretArn(): string {
    return process.env["GITHUB_CLIENT_SECRET_ARN"] ?? "";
  },
};

export type LambdaEvent = APIGatewayProxyEventV2;
export type LambdaResult = APIGatewayProxyResultV2;

export enum Provider {
  GitHub = "github",
}

export function isValidProvider(provider: string | undefined | null): provider is Provider {
  return typeof provider === "string" && (Object.values(Provider) as string[]).includes(provider);
}
