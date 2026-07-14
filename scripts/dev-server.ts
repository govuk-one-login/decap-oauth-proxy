/**
 * Local development server.
 *
 * Wraps the Lambda handlers in an Express server so you can test the full
 * OAuth popup flow in a browser. Point Decap CMS at http://localhost:3000
 * as the base_url.
 *
 * Usage:
 *   npm run dev
 *
 * Requirements:
 *   - Set environment variables (or create a .env file):
 *     GITHUB_CLIENT_ID_PARAM, GITHUB_CLIENT_SECRET_ARN, ALLOWED_ORIGINS
 *   - For local dev without real AWS, set mock deps via the --mock flag:
 *     npm run dev:mock
 */

import express from "express";
import { auth, callback, setDeps, clearCache } from "../src/handler.ts";
import type { LambdaEvent } from "../src/config.ts";
import type { Dependencies } from "../src/handler.ts";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const USE_MOCK = process.argv.includes("--mock");

if (USE_MOCK) {
  console.log("🔧 Running with mock AWS credentials (no real SSM/Secrets Manager)");
  const mockDeps: Partial<Dependencies> = {
    ssmClient: {
      send: async () => ({
        Parameter: { Value: process.env["GITHUB_CLIENT_ID"] ?? "mock-client-id" },
      }),
    },
    secretsClient: {
      send: async () => ({
        SecretString: process.env["GITHUB_CLIENT_SECRET"] ?? "mock-client-secret",
      }),
    },
  };
  clearCache();
  setDeps(mockDeps);
}

const app = express();

/**
 * Convert an Express request into an API Gateway v2 event shape.
 */
function toApiGatewayEvent(req: express.Request): LambdaEvent {
  return {
    headers: req.headers as Record<string, string>,
    queryStringParameters: req.query as Record<string, string>,
    requestContext: {
      domainName: req.hostname,
      stage: "$default",
      http: {
        method: req.method,
        path: req.path,
      },
    },
  } as unknown as LambdaEvent;
}

app.get("/auth", async (req, res) => {
  const event = toApiGatewayEvent(req);
  const result = await auth(event);

  if (typeof result === "string") {
    res.send(result);
    return;
  }

  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      if (typeof value === "string") {
        res.setHeader(key, value);
      }
    }
  }

  res.status(result.statusCode ?? 200).send(result.body ?? "");
});

app.get("/callback", async (req, res) => {
  const event = toApiGatewayEvent(req);
  const result = await callback(event);

  if (typeof result === "string") {
    res.send(result);
    return;
  }

  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      if (typeof value === "string") {
        res.setHeader(key, value);
      }
    }
  }

  res.status(result.statusCode ?? 200).send(result.body ?? "");
});

app.get("/", (_req, res) => {
  res.send("decap-oauth-proxy dev server running. CMS should use this as base_url.");
});

app.listen(PORT, () => {
  console.log(`\n🚀 OAuth proxy dev server running at http://localhost:${PORT.toString()}`);
  console.log(`\n   Configure Decap CMS with:`);
  console.log(`     base_url: http://localhost:${PORT.toString()}`);
  console.log(`     auth_endpoint: auth\n`);
  if (USE_MOCK) {
    console.log(`   Mock mode: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET env vars`);
    console.log(`   to use real GitHub OAuth with mock AWS credentials.\n`);
  }
});
