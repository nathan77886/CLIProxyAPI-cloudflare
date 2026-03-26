/**
 * src/container.ts
 *
 * Cloudflare Container Durable Object class.
 *
 * Extends the `Container` base class from `@cloudflare/containers`, which
 * manages the full container lifecycle (start / stop / health-check) and
 * transparently proxies HTTP and WebSocket requests to the process running
 * inside the container.
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

import { Container } from "@cloudflare/containers";

/** The port CLIProxyAPI listens on inside the container */
const CONTAINER_PORT = 8317;

/**
 * CLIProxyContainer
 *
 * Durable Object / Container class that wraps the CLIProxyAPI process.
 * By extending `Container`, Cloudflare automatically:
 *   - Builds and starts the container image defined in wrangler.jsonc
 *   - Routes fetch() calls to the container on `defaultPort`
 *   - Forwards WebSocket upgrades transparently
 *   - Restarts the container on failure
 *
 * See: https://developers.cloudflare.com/containers/
 */
export class CLIProxyContainer extends Container {
  /** Forward all requests to the CLIProxyAPI HTTP server inside the container */
  override defaultPort = CONTAINER_PORT;
}
