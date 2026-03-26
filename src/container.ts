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
 *   4. This class forwards the request to the actual CLIProxyAPI process
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

// Cloudflare's Container base class is provided by the Workers runtime.
// The import path uses the cloudflare:workers module which is available
// in the Workers environment at runtime (not at compile time via npm).
// We declare a minimal interface here to satisfy the TypeScript compiler.

/** Minimal interface matching the Cloudflare Container Durable Object base */
interface CloudflareContainer {
  fetch(request: Request): Promise<Response>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Container: new (ctx: DurableObjectState, env: unknown) => CloudflareContainer =
  // At runtime Cloudflare provides this via `cloudflare:workers`; at compile
  // time we fall back to a no-op base so TypeScript is satisfied.
  (class {
    fetch(_request: Request): Promise<Response> {
      return Promise.resolve(new Response("Container base not available", { status: 500 }));
    }
  }) as unknown as new (ctx: DurableObjectState, env: unknown) => CloudflareContainer;

/** The port CLIProxyAPI listens on inside the container */
const CONTAINER_PORT = 8317;

/**
 * CLIProxyContainer
 *
 * Durable Object / Container class that wraps the CLIProxyAPI process.
 * The Workers runtime starts one container instance per Durable Object ID.
 *
 * All requests arrive via `fetch()` which is called by the Worker's proxy
 * layer. The method simply rewrites the URL to target localhost inside the
 * container and delegates to the base class's built-in HTTP forwarding.
 */
export class CLIProxyContainer implements CloudflareContainer {
  // Delegate fetch to the Cloudflare Container base class.
  // The base class routes the request to the container's internal HTTP server.
  private readonly base: CloudflareContainer;

  constructor(ctx: DurableObjectState, env: unknown) {
    this.base = new Container(ctx, env);
  }

  /**
   * Handle a proxied request from the Worker.
   *
   * The incoming URL has already been rewritten by the Worker to use the
   * container's Durable Object fetch path. We forward it to the CLIProxyAPI
   * process running on CONTAINER_PORT.
   */
  async fetch(request: Request): Promise<Response> {
    // Rewrite URL to target the container-internal HTTP server
    const url = new URL(request.url);
    const targetUrl = `http://localhost:${CONTAINER_PORT}${url.pathname}${url.search}`;

    try {
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

      return await this.base.fetch(proxiedRequest);
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
