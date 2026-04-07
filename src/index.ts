/**
 * src/index.ts
 *
 * Cloudflare Worker entry point.
 *
 * Architecture:
 *   Internet → Worker (this file) → Container (CLIProxyContainer DO)
 *
 * Responsibilities:
 *   1. Proxy — transparently forward ALL HTTP and WebSocket requests to the
 *              container without any authentication or routing logic.
 *   2. Errors — graceful JSON error responses when the container is unreachable.
 *
 * Authentication is handled entirely by CLIProxyAPI inside the container.
 * The Worker is a pure pass-through layer.
 */

import { CLIProxyContainer } from "./container.js";
import type { Env } from "./types.js";

export { CLIProxyContainer };

// ---------------------------------------------------------------------------
// Helper: obtain a stable container instance stub
// ---------------------------------------------------------------------------

/**
 * Returns a Durable Object stub for the singleton container instance.
 *
 * All Worker requests hit the same container via a fixed DO ID ("singleton").
 */
function getContainerStub(env: Env): DurableObjectStub {
  const id = env.CONTAINER.idFromName("singleton");
  return env.CONTAINER.get(id);
}

// ---------------------------------------------------------------------------
// Main fetch handler — transparent proxy, no auth, no routing
// ---------------------------------------------------------------------------

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    let stub: DurableObjectStub;
    try {
      stub = getContainerStub(env);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[worker] Container binding error:", message);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: "Container unavailable" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { method, url } = request;

    // WebSocket upgrade
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() === "websocket") {
      console.log(`[worker] WS  ${method} ${url}`);
      try {
        const response = await stub.fetch(request);
        if (response.status === 403) {
          const reqHeaders: Record<string, string> = {};
          request.headers.forEach((value, key) => { reqHeaders[key] = value; });
          console.error(
            `[worker] WS 403 ${method} ${url}`,
            JSON.stringify({ requestHeaders: reqHeaders })
          );
        }
        return response;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[worker] WebSocket proxy error:", message);
        return new Response(
          JSON.stringify({ error: "Bad Gateway", message: "Container WebSocket unreachable" }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Standard HTTP — forward everything to the container
    console.log(`[worker] --> ${method} ${url}`);
    try {
      const response = await stub.fetch(request);
      console.log(`[worker] <-- ${method} ${url} ${response.status}`);

      if (response.status === 403) {
        // Clone the response so we can read the body for logging while still
        // returning the original (unread) stream to the caller.
        const cloned = response.clone();
        let responseBody = "(unreadable)";
        try {
          responseBody = await cloned.text();
        } catch {
          // ignore body-read failures
        }
        const reqHeaders: Record<string, string> = {};
        request.headers.forEach((value, key) => { reqHeaders[key] = value; });
        const resHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => { resHeaders[key] = value; });
        console.error(
          `[worker] 403 detail ${method} ${url}`,
          JSON.stringify({ requestHeaders: reqHeaders, responseHeaders: resHeaders, responseBody })
        );
      }

      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[worker] HTTP proxy error:", message);
      return new Response(
        JSON.stringify({ error: "Bad Gateway", message: "Container unreachable" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};

export default worker;
