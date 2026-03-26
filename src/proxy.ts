/**
 * src/proxy.ts
 *
 * HTTP reverse-proxy logic from Cloudflare Worker → Container.
 *
 * Key design decisions:
 *   - Uses fetch() to forward requests to the container.
 *   - Strips hop-by-hop headers that must not be forwarded (RFC 7230 §6.1).
 *   - Preserves the original request body and all safe headers.
 *   - Supports streaming responses (e.g. OpenAI server-sent events).
 *     Cloudflare Workers stream responses natively when you return a Response
 *     whose body is a ReadableStream — no special handling required.
 *   - Preserves the original URL path and query string.
 */

// Headers that MUST NOT be forwarded to or from an upstream (RFC 7230 §6.1)
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Build a clean copy of `headers`, dropping hop-by-hop entries and any
 * headers listed in the Connection header's value.
 */
function sanitizeRequestHeaders(headers: Headers): Headers {
  const result = new Headers();

  // Collect any connection-specific header names to drop
  const connectionValue = headers.get("connection") ?? "";
  const connectionHeaders = new Set(
    connectionValue.split(",").map((h) => h.trim().toLowerCase())
  );

  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || connectionHeaders.has(lower)) {
      continue;
    }
    result.set(name, value);
  }

  return result;
}

/**
 * Build a clean copy of the upstream response headers, dropping hop-by-hop
 * entries before forwarding to the client.
 */
function sanitizeResponseHeaders(headers: Headers): Headers {
  const result = new Headers();

  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }
    result.set(name, value);
  }

  return result;
}

/**
 * Constructs the target URL inside the container.
 *
 * @param containerBaseUrl  Base URL of the container (e.g. http://container/)
 * @param incomingRequest   The original request received by the Worker
 */
function buildTargetUrl(
  containerBaseUrl: string,
  incomingRequest: Request
): string {
  const url = new URL(incomingRequest.url);
  const base = containerBaseUrl.replace(/\/$/, "");
  // Preserve path + query string; strip the Workers hostname
  return `${base}${url.pathname}${url.search}`;
}

/**
 * Forwards an HTTP request to the container and returns the response.
 *
 * Streaming is handled transparently: the Response body is a ReadableStream
 * that the Cloudflare runtime pipes to the client without buffering.
 *
 * @param request           The original incoming Worker request
 * @param containerBaseUrl  Base URL exposed by the container binding
 * @returns                 The proxied response (may be a stream)
 */
export async function proxyHttpRequest(
  request: Request,
  containerBaseUrl: string
): Promise<Response> {
  const targetUrl = buildTargetUrl(containerBaseUrl, request);
  const forwardHeaders = sanitizeRequestHeaders(request.headers);

  // Add X-Forwarded-* headers so CLIProxyAPI can reconstruct the real client IP
  // Workers always provide cf.connecting_ip (but we access it via headers here)
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    forwardHeaders.set("X-Forwarded-For", cfConnectingIp);
    forwardHeaders.set("X-Real-IP", cfConnectingIp);
  }

  // Do NOT forward the Authorization header to the container — it was already
  // validated by the Worker and CLIProxyAPI has its own auth model.
  forwardHeaders.delete("authorization");

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      // Body is null for GET/HEAD; pass through for all other methods.
      // We cast to BodyInit because Request.body is ReadableStream<Uint8Array>
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? request.body
          : null,
      // Disable automatic redirect following so we can forward 3xx to client
      redirect: "manual",
      // Cloudflare Workers do not support duplex streaming yet, but we set
      // the duplex option for future compatibility with the fetch spec.
      // @ts-expect-error -- duplex is not yet in @cloudflare/workers-types
      duplex: "half",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] Failed to reach container at ${targetUrl}:`, message);
    return new Response(
      JSON.stringify({ error: "Bad Gateway", message: "Container unreachable" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const responseHeaders = sanitizeResponseHeaders(upstreamResponse.headers);

  // Return the response; if the body is a stream (e.g. SSE / chunked JSON)
  // the Workers runtime will pipe it without buffering.
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
