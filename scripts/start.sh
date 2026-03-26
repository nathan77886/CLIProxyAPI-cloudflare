#!/bin/sh
# scripts/start.sh
#
# Container startup wrapper for CLIProxyAPI.
#
# Responsibilities:
#   1. Validate that all required environment variables are present.
#   2. Emit a structured startup log so operators can confirm config.
#   3. Exec into the CLIProxyAPI process (replaces this shell — proper PID 1).
#
# If any required variable is missing the script exits with code 1 so
# Cloudflare can detect the failed start and report an error.

set -eu

# ---------------------------------------------------------------------------
# Required environment variables
# ---------------------------------------------------------------------------
# DB connection is direct from container — no Hyperdrive
# REQUIRED_VARS="PGSTORE_DSN OBJECTSTORE_ENDPOINT OBJECTSTORE_ACCESS_KEY OBJECTSTORE_SECRET_KEY OBJECTSTORE_BUCKET"
echo $PGSTORE_DSN
# MISSING=""
# for VAR in $REQUIRED_VARS; do
#   # Use indirect variable expansion (POSIX sh safe)
#   eval "VALUE=\${${VAR}:-}"
#   if [ -z "$VALUE" ]; then
#     MISSING="$MISSING $VAR"
#   fi
# done

# if [ -n "$MISSING" ]; then
#   echo "{\"level\":\"ERROR\",\"msg\":\"Missing required environment variables\",\"vars\":\"$MISSING\"}" >&2
#   exit 1
# fi

# ---------------------------------------------------------------------------
# Startup log (no secret values logged)
# ---------------------------------------------------------------------------
echo "{\"level\":\"INFO\",\"msg\":\"Starting CLIProxyAPI\",\"port\":\"${PORT}\",\"objectstore_bucket\":\"${OBJECTSTORE_BUCKET}\"}"

# ---------------------------------------------------------------------------
# Hand off to CLIProxyAPI
# exec replaces this process so CLIProxyAPI becomes PID 1 inside the container
# ---------------------------------------------------------------------------
exec /app/cliproxyapi
