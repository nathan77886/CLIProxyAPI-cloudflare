/**
 * src/index.ts
 *
 * Cloudflare Worker entry point.
 *
 * Architecture:
 *   Internet → Worker (this file) → Container (CLIProxyContainer DO)
 *
 * Responsibilities:
 *   1. Routing  — decide which handler processes the request
 *   2. Auth     — validate Bearer token on protected routes
 *   3. Proxy    — forward HTTP or WebSocket requests to the container
 *   4. Logging  — structured log lines per request
 *   5. Errors   — graceful JSON error responses
 *
 * The Container is NEVER directly reachable from the internet.
 * All traffic MUST pass through this Worker.
 */

import { authenticate, unauthorizedResponse } from "./auth.js";
import { proxyHttpRequest } from "./proxy.js";
import { proxyWebSocket } from "./websocket.js";
import { CLIProxyContainer } from "./container.js";
import type { Env } from "./types.js";

export { CLIProxyContainer };

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

/** Health check path — public, no auth required */
const HEALTH_PATH = "/health";

// ---------------------------------------------------------------------------
// Helper: obtain a stable container instance URL
// ---------------------------------------------------------------------------

/**
 * Returns the base URL used to call the container.
 *
 * Cloudflare Container Durable Objects expose a `fetch()` method. The
 * Workers runtime routes the call to the container process automatically.
 * We use a fixed Durable Object ID ("singleton") so all Worker requests
 * hit the same container instance.
 */
function getContainerStub(env: Env): DurableObjectStub {
  const id = env.CONTAINER.idFromName("singleton");
  return env.CONTAINER.get(id);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(
  level: "INFO" | "WARN" | "ERROR",
  method: string,
  path: string,
  status: number,
  message?: string
): void {
  const entry = {
    level,
    method,
    path,
    status,
    ...(message ? { message } : {}),
    ts: new Date().toISOString(),
  };
  if (level === "ERROR") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ---------------------------------------------------------------------------
// Internal proxy helpers that route through the Durable Object stub
// ---------------------------------------------------------------------------

/**
 * Proxy a standard HTTP request through the Durable Object stub.
 *
 * The stub's fetch() accepts the original request and forwards it to the
 * container process. We use the container's internal routing via the DO stub
 * rather than a raw URL so Cloudflare handles the network path.
 */
async function proxyHttpViaDO(
  request: Request,
  stub: DurableObjectStub
): Promise<Response> {
  try {
    // Forward the request to the Durable Object (container)
    // The DO rewrites the URL internally to http://localhost:8317/...
    return await stub.fetch(request);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[worker] HTTP proxy error:", message);
    return new Response(
      JSON.stringify({ error: "Bad Gateway", message: "Container unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Proxy a WebSocket upgrade through the Durable Object stub.
 *
 * Cloudflare Durable Objects support WebSocket connections natively via
 * stub.fetch() when the request has Upgrade: websocket.
 */
async function proxyWebSocketViaDO(
  request: Request,
  stub: DurableObjectStub
): Promise<Response> {
  try {
    return await stub.fetch(request);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[worker] WebSocket proxy error:", message);
    return new Response(
      JSON.stringify({ error: "Bad Gateway", message: "Container WebSocket unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ------------------------------------------------------------------
    // 1. Health check — public route, no auth
    // ------------------------------------------------------------------
    if (path === HEALTH_PATH && method === "GET") {
      log("INFO", method, path, 200);
      return new Response(
        JSON.stringify({ status: "ok", service: "cliproxyapi-worker" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ------------------------------------------------------------------
    // 2. Authentication — required for all other routes
    // ------------------------------------------------------------------
    const authResult = await authenticate(request, env.API_TOKEN);
    if (!authResult.ok) {
      const reason = authResult.reason ?? "Unauthorized";
      log("WARN", method, path, 401, reason);
      return unauthorizedResponse(reason);
    }

    // ------------------------------------------------------------------
    // 3. Obtain the container stub
    // ------------------------------------------------------------------
    let stub: DurableObjectStub;
    try {
      stub = getContainerStub(env);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log("ERROR", method, path, 500, `Container binding error: ${message}`);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: "Container unavailable" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ------------------------------------------------------------------
    // 4. WebSocket upgrade
    // ------------------------------------------------------------------
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() === "websocket") {
      log("INFO", method, path, 101, "WebSocket upgrade");
      return proxyWebSocketViaDO(request, stub);
    }

    // ------------------------------------------------------------------
    // 5. Standard HTTP proxy
    // ------------------------------------------------------------------
    const response = await proxyHttpViaDO(request, stub);
    log(
      response.status >= 500 ? "ERROR" : "INFO",
      method,
      path,
      response.status
    );
    return response;
  },
};

export default worker;

// ---------------------------------------------------------------------------
// Re-export proxy helpers for potential direct use in tests
// ---------------------------------------------------------------------------
export { proxyHttpRequest, proxyWebSocket };
