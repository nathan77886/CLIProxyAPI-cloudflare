# CLIProxyAPI-cloudflare

Cloudflare-native deployment of [CLIProxyAPI](https://github.com/soulteary/CLIProxyAPI) using **Cloudflare Workers + Containers**.

```
Internet
   │
   ▼
Cloudflare Worker  (transparent proxy — no auth, no routing)
   │
   ▼
Cloudflare Container  (CLIProxyAPI process — handles auth internally)
   │              │
   ▼              ▼
PostgreSQL       Cloudflare R2
(Aliyun SG)     (object storage)
```

The **Worker** is the only public entry point and acts as a pure pass-through proxy. The Container is never directly reachable. Authentication is handled entirely by CLIProxyAPI inside the container.

---

## Project Structure

```
.
├── src/
│   ├── index.ts        # Worker entry point (transparent proxy)
│   ├── container.ts    # Cloudflare Container Durable Object class
│   ├── types.ts        # Shared TypeScript types
│   ├── auth.ts         # (reference only) Bearer-token auth — not used by Worker
│   ├── proxy.ts        # (reference only) HTTP reverse-proxy helpers
│   └── websocket.ts    # (reference only) WebSocket proxy helpers
├── scripts/
│   └── start.sh        # Container startup script (env validation + exec)
├── Dockerfile          # Container image definition
├── wrangler.jsonc      # Cloudflare Workers + Containers configuration
├── package.json
└── tsconfig.json
```

---

## Environment Variables

### Container-level (injected into the container process)

| Variable | Where Set | Description |
|----------|-----------|-------------|
| `PORT` | `wrangler.jsonc` `container_env` | Port CLIProxyAPI listens on (hardcoded: 8317) |
| `PGSTORE_DSN` | `wrangler secret put PGSTORE_DSN` | PostgreSQL DSN — **direct connection**, no Hyperdrive |
| `OBJECTSTORE_ENDPOINT` | `wrangler secret put OBJECTSTORE_ENDPOINT` | R2-compatible S3 endpoint URL |
| `OBJECTSTORE_ACCESS_KEY` | `wrangler secret put OBJECTSTORE_ACCESS_KEY` | R2 access key ID |
| `OBJECTSTORE_SECRET_KEY` | `wrangler secret put OBJECTSTORE_SECRET_KEY` | R2 secret access key |
| `OBJECTSTORE_BUCKET` | `wrangler.jsonc` `container_env` | R2 bucket name |
| `MANAGEMENT_PASSWORD` | `wrangler secret put MANAGEMENT_PASSWORD` | CLIProxyAPI management password |

> **Note:** No `API_TOKEN` is needed at the Worker level. CLIProxyAPI provides its own authentication inside the container on port 8317.

> **Security note:** Never commit real secret values. Always use `wrangler secret put` for sensitive values.

---

## Local Development

### Prerequisites

- Node.js ≥ 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+
- Docker (for container builds)

### Setup

```bash
npm install
```

### Create `.dev.vars` for local secrets

```bash
cat > .dev.vars <<EOF
PGSTORE_DSN=postgres://user:pass@localhost:5432/cliproxyapi?sslmode=disable
OBJECTSTORE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
OBJECTSTORE_ACCESS_KEY=your-r2-access-key
OBJECTSTORE_SECRET_KEY=your-r2-secret-key
OBJECTSTORE_BUCKET=cliproxyapi
MANAGEMENT_PASSWORD=changeme
EOF
```

> `.dev.vars` is listed in `.gitignore` — never commit it.

### Run locally

```bash
npm run dev
# Worker starts at http://localhost:8787
```

### Type-check

```bash
npm run type-check
```

---

## Deployment

### 1. Install Wrangler and log in

```bash
npm install -g wrangler
wrangler login
```

### 2. Set secrets

```bash
# Container secrets (injected into the container process at runtime)
wrangler secret put PGSTORE_DSN
wrangler secret put OBJECTSTORE_ENDPOINT
wrangler secret put OBJECTSTORE_ACCESS_KEY
wrangler secret put OBJECTSTORE_SECRET_KEY
wrangler secret put MANAGEMENT_PASSWORD
```

### 3. Build the container image

Cloudflare builds the container image from the Dockerfile automatically when you run `wrangler deploy`. Alternatively, build and push manually:

```bash
# Wrangler handles this automatically:
wrangler deploy
```

### 4. Update wrangler.jsonc

- Replace `api.example.com` with your actual domain.
- Set `zone_name` to your Cloudflare zone.
- Replace `REPLACE_WITH_R2_ENDPOINT` and `REPLACE_WITH_BUCKET_NAME` with real values.

### 5. Deploy

```bash
wrangler deploy
```

### 6. Verify

```bash
curl https://api.example.com/health
# Response is forwarded directly from CLIProxyAPI
```

---

## Example Requests

All requests are forwarded transparently to CLIProxyAPI. Authentication headers are passed through as-is and validated by CLIProxyAPI inside the container.

### Health check

```bash
curl https://api.example.com/health
```

### API request

```bash
curl -H "Authorization: Bearer $YOUR_CLIPROXY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}' \
     https://api.example.com/v1/chat/completions
```

### Streaming request (OpenAI-style SSE)

```bash
curl -H "Authorization: Bearer $YOUR_CLIPROXY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}],"stream":true}' \
     --no-buffer \
     https://api.example.com/v1/chat/completions
```

### WebSocket connection

```bash
# Using wscat (npm install -g wscat)
wscat -c "wss://api.example.com/ws"
```

---

## Architecture

1. **Worker is a pure pass-through** — all requests (HTTP and WebSocket) are forwarded to the container without any modification or auth check.
2. **Authentication is handled by CLIProxyAPI** inside the container on port **8317**.
3. **Container is not publicly exposed** — only reachable via Worker Durable Object binding.
4. **DB credentials** (`PGSTORE_DSN`) are injected only into the container process, never into the Worker.
5. **Port 8317 is hardcoded** — CLIProxyAPI always listens on this port inside the container.

---

## Future Extensibility

```typescript
// TODO: Hyperdrive support
// When Cloudflare Hyperdrive supports Container-to-Hyperdrive connections,
// replace PGSTORE_DSN direct connection with a Hyperdrive binding.
// See: https://developers.cloudflare.com/hyperdrive/

// TODO: Metrics
// Add Workers Analytics Engine bindings for per-request metrics.
// See: https://developers.cloudflare.com/analytics/analytics-engine/
```