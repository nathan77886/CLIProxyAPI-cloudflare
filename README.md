# CLIProxyAPI-cloudflare

Cloudflare-native deployment of [CLIProxyAPI](https://github.com/soulteary/CLIProxyAPI) using **Cloudflare Workers + Containers**.

```
Internet
   │
   ▼
Cloudflare Worker  (auth + routing + proxy)
   │
   ▼
Cloudflare Container  (CLIProxyAPI process)
   │              │
   ▼              ▼
PostgreSQL       Cloudflare R2
(Aliyun SG)     (object storage)
```

The **Worker** is the only public entry point. The Container is never directly reachable.

---

## Project Structure

```
.
├── src/
│   ├── index.ts        # Worker entry point (routing, auth, proxy orchestration)
│   ├── auth.ts         # Bearer-token authentication middleware
│   ├── proxy.ts        # HTTP reverse-proxy logic (streaming support)
│   ├── websocket.ts    # WebSocket proxy logic
│   ├── container.ts    # Cloudflare Container Durable Object class
│   └── types.ts        # Shared TypeScript types
├── scripts/
│   └── start.sh        # Container startup script (env validation + exec)
├── Dockerfile          # Container image definition
├── wrangler.jsonc      # Cloudflare Workers + Containers configuration
├── package.json
└── tsconfig.json
```

---

## Environment Variables

### Worker-level (validated by the Worker)

| Variable | Where Set | Description |
|----------|-----------|-------------|
| `API_TOKEN` | `wrangler secret put API_TOKEN` | Bearer token required on every request |

### Container-level (injected into the container process)

| Variable | Where Set | Description |
|----------|-----------|-------------|
| `PORT` | `wrangler.jsonc` `container_env` | Port CLIProxyAPI listens on (default: 8317) |
| `PGSTORE_DSN` | `wrangler secret put PGSTORE_DSN` | PostgreSQL DSN — **direct connection**, no Hyperdrive |
| `OBJECTSTORE_ENDPOINT` | `wrangler secret put OBJECTSTORE_ENDPOINT` | R2-compatible S3 endpoint URL |
| `OBJECTSTORE_ACCESS_KEY` | `wrangler secret put OBJECTSTORE_ACCESS_KEY` | R2 access key ID |
| `OBJECTSTORE_SECRET_KEY` | `wrangler secret put OBJECTSTORE_SECRET_KEY` | R2 secret access key |
| `OBJECTSTORE_BUCKET` | `wrangler.jsonc` `container_env` | R2 bucket name |
| `MANAGEMENT_PASSWORD` | `wrangler secret put MANAGEMENT_PASSWORD` | CLIProxyAPI management password |

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
API_TOKEN=dev-token-change-me
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
# Worker secret
wrangler secret put API_TOKEN

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
# or for a specific environment:
wrangler deploy --env production
```

### 6. Verify

```bash
curl https://api.example.com/health
# {"status":"ok","service":"cliproxyapi-worker"}
```

---

## Example Requests

### Health check (public, no auth)

```bash
curl https://api.example.com/health
```

### Authenticated API request

```bash
export API_TOKEN="your-bearer-token"

curl -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}' \
     https://api.example.com/v1/chat/completions
```

### Streaming request (OpenAI-style SSE)

```bash
curl -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}],"stream":true}' \
     --no-buffer \
     https://api.example.com/v1/chat/completions
```

### WebSocket connection

```bash
# Using wscat (npm install -g wscat)
wscat -c "wss://api.example.com/ws" \
      -H "Authorization: Bearer $API_TOKEN"
```

---

## Security Architecture

1. **Worker validates Bearer token** on every request before touching the container.
2. **Container is not publicly exposed** — only reachable via Worker Durable Object binding.
3. **DB credentials** (`PGSTORE_DSN`) are injected only into the container process, never into the Worker.
4. **Authorization header** is stripped before forwarding to the container.
5. **Timing-safe comparison** prevents token enumeration attacks.

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

// TODO: Audit logs
// Log auth events (success/failure) to an audit trail (KV or external sink).

// TODO: Rate limiting
// Add Cloudflare Rate Limiting rules or Workers Rate Limiting API.
// See: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
```