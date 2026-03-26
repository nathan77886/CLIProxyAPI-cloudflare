/**
 * src/container.ts
 *
 * Cloudflare Container Durable Object class.
 *
 * This class is bound to the Worker via the `containers` array in
 * wrangler.jsonc. The Workers runtime automatically manages the container
 * lifecycle (start / stop / health-check).
 *
 * How it works:
 *   1. Worker receives a request.
 *   2. Worker calls `env.CONTAINER.get(id)` to obtain a Durable Object stub.
 *   3. Worker calls `stub.fetch(request)` which is routed here.
 *   4. This class uses `ctx.container.getTcpPort()` — the official Cloudflare
 *      Workers Containers API — to forward requests to the CLIProxyAPI process
 *      running inside the container on port 8317.
 *
 * Container environment variables (injected by Cloudflare, NOT visible to
 * the Worker):
 *   - PORT                  : 8317
 *   - PGSTORE_DSN           : PostgreSQL DSN (direct connection, no Hyperdrive)
 *   - OBJECTSTORE_ENDPOINT  : R2-compatible S3 endpoint
 *   - OBJECTSTORE_ACCESS_KEY: R2 access key
 *   - OBJECTSTORE_SECRET_KEY: R2 secret key
 *   - OBJECTSTORE_BUCKET    : R2 bucket name
 *   - MANAGEMENT_PASSWORD   : CLIProxyAPI management password
 */

import type { Env } from "./types.js";

/** The port CLIProxyAPI listens on inside the container */
const CONTAINER_PORT = 8317;

/**
 * CLIProxyContainer
 *
 * Durable Object / Container class that wraps the CLIProxyAPI process.
 * The Workers runtime starts one container instance per Durable Object ID.
 *
 * Requests arrive via `fetch()` from the Worker's proxy layer. The method
 * uses `ctx.container.getTcpPort()` to obtain a Fetcher that routes
 * requests directly to the CLIProxyAPI HTTP server inside the container.
 *
 * See: https://developers.cloudflare.com/workers/configuration/containers/
 */
export class CLIProxyContainer {
  private readonly ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  /**
   * Handle a proxied request from the Worker.
   *
   * Uses `ctx.container.getTcpPort(CONTAINER_PORT)` to get a Fetcher bound
   * to the container's internal HTTP server, then forwards the request with
   * the URL rewritten to localhost so the CLIProxyAPI process receives the
   * correct path and query string.
   */
  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container;

    if (!container) {
      console.error("[container] ctx.container is not available -- is this DO bound to a container in wrangler.jsonc?");
      return new Response(
        JSON.stringify({
          error: "Container Error",
          message: "Container binding unavailable",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    try {
      // Get a Fetcher for the container's TCP port.
      // getTcpPort() routes HTTP requests to the container process on that port.
      const fetcher = container.getTcpPort(CONTAINER_PORT);

      // Rewrite URL to target the container-internal HTTP server so the
      // CLIProxyAPI process receives the correct Host and path.
      const url = new URL(request.url);
      const targetUrl = `http://localhost:${CONTAINER_PORT}${url.pathname}${url.search}`;

      const proxiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body:
          request.method !== "GET" && request.method !== "HEAD"
            ? request.body
            : null,
        // @ts-expect-error -- duplex is not yet in @cloudflare/workers-types
        duplex: "half",
      });

      return await fetcher.fetch(proxiedRequest);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[container] Error forwarding to CLIProxyAPI:", message);
      return new Response(
        JSON.stringify({
          error: "Container Error",
          message: "CLIProxyAPI is not responding",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
}
