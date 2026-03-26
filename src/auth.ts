/**
 * src/auth.ts
 *
 * Bearer-token authentication middleware for the Cloudflare Worker.
 *
 * Security model:
 *   - Every request (except public routes like /health) MUST carry
 *     a valid "Authorization: Bearer <API_TOKEN>" header.
 *   - The token is compared in constant time to prevent timing attacks.
 *   - API_TOKEN is injected as a Worker secret via `wrangler secret put`.
 */

import type { AuthResult } from "./types.js";

/**
 * Performs a timing-safe comparison of two strings.
 *
 * Web Crypto's subtle.timingSafeEqual operates on ArrayBuffers; we encode
 * both strings to UTF-8 bytes and pad them to the same length so that
 * the comparison always takes the same amount of time regardless of where
 * a mismatch occurs.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // If lengths differ, the comparison will always fail; we still proceed
  // with a fixed-length comparison to avoid leaking the expected length.
  const maxLen = Math.max(aBytes.length, bBytes.length);
  const aPadded = new Uint8Array(maxLen);
  const bPadded = new Uint8Array(maxLen);
  aPadded.set(aBytes);
  bPadded.set(bBytes);

  // Import as HMAC keys so we can use crypto.subtle.sign for comparison
  const [keyA, keyB] = await Promise.all([
    crypto.subtle.importKey("raw", aPadded, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    crypto.subtle.importKey("raw", bPadded, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  ]);

  // Sign the same fixed message with both keys; equal keys → equal signatures
  const fixedMessage = new Uint8Array(32); // 32 zero bytes
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign("HMAC", keyA, fixedMessage),
    crypto.subtle.sign("HMAC", keyB, fixedMessage),
  ]);

  // Compare signatures byte-by-byte using the built-in constant-time helper
  return crypto.subtle.timingSafeEqual(sigA, sigB);
}

/**
 * Validates the Authorization header of an incoming request.
 *
 * @param request  The incoming Worker Request
 * @param apiToken The expected API token (from Env.API_TOKEN)
 * @returns        AuthResult indicating success or failure with a reason
 */
export async function authenticate(
  request: Request,
  apiToken: string
): Promise<AuthResult> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return { ok: false, reason: "Missing Authorization header" };
  }

  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, reason: "Authorization header must use Bearer scheme" };
  }

  const providedToken = authHeader.slice("Bearer ".length).trim();

  if (!providedToken) {
    return { ok: false, reason: "Bearer token is empty" };
  }

  const isValid = await timingSafeEqual(providedToken, apiToken);

  if (!isValid) {
    return { ok: false, reason: "Invalid Bearer token" };
  }

  return { ok: true };
}

/**
 * Builds a standardised 401 Unauthorized response.
 *
 * The WWW-Authenticate header is included so that HTTP clients know which
 * auth scheme is expected (RFC 6750).
 */
export function unauthorizedResponse(reason: string): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized", message: reason }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="CLIProxyAPI"',
      },
    }
  );
}
