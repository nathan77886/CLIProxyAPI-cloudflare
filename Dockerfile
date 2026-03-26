# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Dockerfile — CLIProxyAPI container for Cloudflare Containers
#
# Base image: official CLIProxyAPI image from Docker Hub
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

FROM soulteary/cliproxyapi:latest

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
