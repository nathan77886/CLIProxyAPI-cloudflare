/**
 * src/types.ts
 *
 * Shared TypeScript types for the Worker and Container binding.
 * Cloudflare Workers run in a V8 isolate; all types here must be
 * compatible with the Workers runtime (no Node.js-only types).
 */

// ---------------------------------------------------------------------------
// Worker environment bindings
// Matches the bindings declared in wrangler.jsonc.
// ---------------------------------------------------------------------------
export interface Env {
  /**
   * Durable Object namespace binding for the container class.
   * Cloudflare injects this automatically based on `containers[].class_name`
   * in wrangler.jsonc.
   * Used in: Worker only (container.ts, index.ts)
   */
  readonly CONTAINER: DurableObjectNamespace;
}

// ---------------------------------------------------------------------------
// Container environment variables (injected into the container process)
// These are NOT available in the Worker; they live inside the container.
// ---------------------------------------------------------------------------
export interface ContainerEnv {
  /** Port CLIProxyAPI listens on. Default: 8317 */
  readonly PORT: string;

  /**
   * PostgreSQL DSN for direct database connection from the container.
   * Format: postgres://user:pass@host:5432/dbname?sslmode=require
   * Set via: wrangler secret put PGSTORE_DSN
   * DO NOT use Hyperdrive — direct connection from container.
   */
  readonly PGSTORE_DSN: string;

  /**
   * R2-compatible S3 endpoint URL.
   * Example: https://<account-id>.r2.cloudflarestorage.com
   * Set via: wrangler secret put OBJECTSTORE_ENDPOINT
   */
  readonly OBJECTSTORE_ENDPOINT: string;

  /** R2 access key ID. Set via: wrangler secret put OBJECTSTORE_ACCESS_KEY */
  readonly OBJECTSTORE_ACCESS_KEY: string;

  /** R2 secret access key. Set via: wrangler secret put OBJECTSTORE_SECRET_KEY */
  readonly OBJECTSTORE_SECRET_KEY: string;

  /** R2 bucket name. */
  readonly OBJECTSTORE_BUCKET: string;

  /**
   * CLIProxyAPI management console password.
   * Set via: wrangler secret put MANAGEMENT_PASSWORD
   */
  readonly MANAGEMENT_PASSWORD: string;
}

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

/** HTTP methods the proxy supports */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";
