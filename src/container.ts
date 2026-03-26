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
import { env } from "cloudflare:workers";
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
  // 关键：把 Worker vars / secrets 传给容器
  override envVars = {
    PORT: String(CONTAINER_PORT),
    PGSTORE_DSN: (env as Record<string, string>).PGSTORE_DSN,
    MANAGEMENT_PASSWORD: (env as Record<string, string>).MANAGEMENT_PASSWORD,

    // 你后面如果还要传 R2/S3 兼容配置，也放这里
    // OBJECTSTORE_ENDPOINT: env.OBJECTSTORE_ENDPOINT,
    // OBJECTSTORE_ACCESS_KEY: env.OBJECTSTORE_ACCESS_KEY,
    // OBJECTSTORE_SECRET_KEY: env.OBJECTSTORE_SECRET_KEY,
    // OBJECTSTORE_BUCKET: env.OBJECTSTORE_BUCKET,
  };
  /**
   * Override fetch to explicitly start the container and wait for the
   * configured port to be ready before forwarding each request.
   *
   * The base class Container.fetch() calls containerFetch() which checks
   * `container.running` to decide whether to call startAndWaitForPorts().
   * When the container is asleep or has just stopped, `container.running`
   * can transiently report `true` (stale state), causing the startup check
   * to be skipped. The subsequent TCP port probe then throws:
   *   "The container is not running, consider calling start()"
   *
   * By calling startAndWaitForPorts() here first we guarantee the container
   * is fully started and the port is accepting connections before any
   * proxying takes place. If the container is already healthy this call
   * returns immediately and has no performance impact.
   */
  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts(CONTAINER_PORT);
    return super.fetch(request);
  }
}
