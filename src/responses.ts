import type { Provider } from "./config.ts";
import type { LambdaResult } from "./config.ts";

/**
 * Build the HTML response for the OAuth callback popup.
 *
 * Implements the Decap CMS postMessage protocol:
 * 1. Popup listens for parent's handshake acknowledgement
 * 2. Popup posts "authorizing:<provider>" to opener
 * 3. Parent echoes the handshake back
 * 4. Popup posts "authorization:<provider>:success:<json>" or error
 * 5. Popup closes
 *
 * The origin is always explicit (never "*") to prevent token leakage.
 *
 * @see https://github.com/decaporg/decap-cms/blob/main/packages/decap-cms-lib-auth/src/netlify-auth.js
 */
export function successResponse(
  token: string,
  provider: Provider,
  targetOrigin: string,
): LambdaResult {
  const html = buildCallbackHtml(
    provider,
    targetOrigin,
    "success",
    JSON.stringify({ token, provider }),
  );
  return htmlResponse(html);
}

export function errorResponse(
  message: string,
  provider: Provider,
  targetOrigin: string,
): LambdaResult {
  const html = buildCallbackHtml(provider, targetOrigin, "error", JSON.stringify({ message }));
  return htmlResponse(html);
}

function buildCallbackHtml(
  provider: Provider,
  origin: string,
  status: "success" | "error",
  payload: string,
): string {
  return `<!DOCTYPE html>
<html>
  <head><title>OAuth Callback</title></head>
  <body>
    <script>
      (function() {
        var provider = ${JSON.stringify(provider)};
        var origin = ${JSON.stringify(origin)};
        var status = ${JSON.stringify(status)};
        var payload = ${JSON.stringify(payload)};

        function receiveMessage(e) {
          if (e.origin !== origin) return;
          if (e.data === "authorizing:" + provider) {
            // Parent acknowledged the handshake, send the result
            window.opener.postMessage(
              "authorization:" + provider + ":" + status + ":" + payload,
              origin
            );
            window.removeEventListener("message", receiveMessage);
            window.close();
          }
        }

        window.addEventListener("message", receiveMessage, false);

        // Initiate handshake with opener
        if (window.opener) {
          window.opener.postMessage("authorizing:" + provider, origin);
        } else {
          document.body.innerText = status === "success"
            ? "Authentication successful. You can close this window."
            : "Authentication error: " + payload;
        }
      })();
    </script>
  </body>
</html>`;
}

function htmlResponse(body: string): LambdaResult {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body,
  };
}
