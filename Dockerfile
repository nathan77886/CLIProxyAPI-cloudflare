# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Dockerfile — CLIProxyAPI container for Cloudflare Containers
#
# Builds CLIProxyAPI from source (github.com/router-for-me/CLIProxyAPI)
# using a multi-stage build, so no pre-built Docker Hub image is required.
# Port: 8317 (CLIProxyAPI default)
#
# Environment variables injected by Cloudflare at runtime (set via secrets):
#   - PORT                  : 8317
#   - PGSTORE_DSN           : PostgreSQL DSN (direct, no Hyperdrive)
#   - OBJECTSTORE_ENDPOINT  : R2-compatible S3 endpoint
#   - OBJECTSTORE_ACCESS_KEY: R2 access key ID
#   - OBJECTSTORE_SECRET_KEY: R2 secret access key
#   - OBJECTSTORE_BUCKET    : R2 bucket name
#   - MANAGEMENT_PASSWORD   : CLIProxyAPI management password
# ---------------------------------------------------------------------------

# Stage 1 — clone and compile CLIProxyAPI from source
FROM golang:1.26-alpine AS builder

RUN apk add --no-cache git

WORKDIR /src

RUN git clone --depth 1 https://github.com/router-for-me/CLIProxyAPI.git .

RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o /app/cliproxyapi \
    ./cmd/server/

# Stage 2 — minimal runtime image
FROM alpine:3.22

RUN apk add --no-cache tzdata wget

# Binary lives at /app/cliproxyapi — matches the exec path in scripts/start.sh
RUN mkdir -p /app
COPY --from=builder /app/cliproxyapi /app/cliproxyapi

# config.example.yaml is required by CLIProxyAPI to bootstrap configuration when
# using object store (R2) or postgres store mode. The binary looks for this file
# in its working directory on startup.
COPY config.example.yaml /app/config.example.yaml

WORKDIR /app

# Declare the port CLIProxyAPI listens on so Cloudflare can route traffic
EXPOSE 8317

# Copy optional startup wrapper script that validates required env vars
# and starts CLIProxyAPI. The script exits with a non-zero code if any
# required variable is missing, preventing a zombie container.
COPY scripts/start.sh /start.sh
RUN chmod +x /start.sh

# Health-check so the Cloudflare runtime knows when the container is ready.
# CLIProxyAPI exposes GET /health (or the Worker handles it before reaching here).
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8317/health || exit 1

ENTRYPOINT ["/start.sh"]
