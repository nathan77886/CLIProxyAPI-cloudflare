/**
 * src/websocket.ts
 *
 * WebSocket proxy: upgrades the client-facing connection and tunnels
 * all frames bidirectionally to the container.
 *
 * Cloudflare Workers WebSocket behaviour:
 *   - Use `new WebSocketPair()` to create a [client, server] pair.
 *   - Call `server.accept()` to start the server-side WS in the isolate.
 *   - Return a 101 Switching Protocols response with `webSocket: client`.
 *   - All messages received on `server` are forwarded to the upstream WS,
 *     and vice-versa.
 *
 * Connection lifecycle:
 *   Worker ← (client WS) → Worker isolate ← (upstream WS) → Container
 */

/**
 * Constructs the WebSocket URL pointing at the container.
 * Converts http(s):// → ws(s):// and preserves path + query.
 */
function buildWsTargetUrl(containerBaseUrl: string, incomingRequest: Request): string {
  const url = new URL(incomingRequest.url);
  const base = containerBaseUrl.replace(/\/$/, "");
  // Rewrite scheme: http → ws, https → wss
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}${url.pathname}${url.search}`;
}

/**
 * Pipes a Cloudflare Workers WebSocket connection through to the container.
 *
 * @param request          Original client request (must be a WS upgrade)
 * @param containerBaseUrl Base URL of the container (http://...)
 * @returns                101 Switching Protocols response
 */
export async function proxyWebSocket(
  request: Request,
  containerBaseUrl: string
): Promise<Response> {
  const targetUrl = buildWsTargetUrl(containerBaseUrl, request);

  // Build forwarding headers for the upstream WS handshake.
  // We forward Sec-WebSocket-Protocol to honour subprotocol negotiation.
  const forwardHeaders: Record<string, string> = {};
  const proto = request.headers.get("sec-websocket-protocol");
  if (proto) {
    forwardHeaders["Sec-WebSocket-Protocol"] = proto;
  }

  // Open the upstream WebSocket connection to the container.
  // Cloudflare Workers support fetch() with an Upgrade: websocket header.
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      headers: {
        ...forwardHeaders,
        Upgrade: "websocket",
        Connection: "Upgrade",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ws-proxy] Failed to connect to container WS at ${targetUrl}:`, msg);
    return new Response(
      JSON.stringify({ error: "Bad Gateway", message: "Container WebSocket unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // The Workers runtime attaches the upstream WebSocket to the response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upstream = (upstreamResponse as any).webSocket as WebSocket | null;
  if (!upstream) {
    console.error("[ws-proxy] Upstream did not return a WebSocket");
    return new Response(
      JSON.stringify({ error: "Bad Gateway", message: "Upstream WebSocket unavailable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create the client-facing WebSocket pair.
  // WebSocketPair is a Cloudflare Workers extension; it is an object with
  // numeric keys 0 and 1, not a standard iterable, so we access them directly.
  const pair = new WebSocketPair();
  const clientWs = pair[0];
  const serverWs = pair[1];

  // Accept the server side so we can attach event listeners.
  serverWs.accept();
  upstream.accept();

  // ---- Client → Upstream ----
  serverWs.addEventListener("message", (event: MessageEvent) => {
    try {
      upstream.send(event.data as string | ArrayBuffer);
    } catch (err) {
      console.error("[ws-proxy] Error forwarding client→upstream:", err);
    }
  });

  serverWs.addEventListener("close", (event: CloseEvent) => {
    try {
      upstream.close(event.code, event.reason);
    } catch {
      // Upstream may already be closed; ignore
    }
  });

  serverWs.addEventListener("error", (event: Event) => {
    console.error("[ws-proxy] Client WebSocket error:", event);
    try {
      upstream.close(1011, "Client error");
    } catch {
      // ignore
    }
  });

  // ---- Upstream → Client ----
  upstream.addEventListener("message", (event: MessageEvent) => {
    try {
      serverWs.send(event.data as string | ArrayBuffer);
    } catch (err) {
      console.error("[ws-proxy] Error forwarding upstream→client:", err);
    }
  });

  upstream.addEventListener("close", (event: CloseEvent) => {
    try {
      serverWs.close(event.code, event.reason);
    } catch {
      // Client may already be closed; ignore
    }
  });

  upstream.addEventListener("error", (event: Event) => {
    console.error("[ws-proxy] Upstream WebSocket error:", event);
    try {
      serverWs.close(1011, "Upstream error");
    } catch {
      // ignore
    }
  });

  // Return 101 Switching Protocols with the client-facing socket.
  return new Response(null, {
    status: 101,
    webSocket: clientWs,
  });
}
