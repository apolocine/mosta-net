#!/bin/bash
# Author: Dr Hamid MADANI drmdh@msn.com
# Start @mostajs/net standalone server
# Usage: ./start-net.sh [port]
#
# Schemas: loaded from schemas.json (if exists) or scanned from SCHEMAS_PATH
# Config:  loaded from .env.local
set -euo pipefail

cd "$(dirname "$0")"

# Load .env.local if present
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

# Override port if passed as argument
[ -n "${1:-}" ] && export MOSTA_NET_PORT="$1"

# Enable transports if not already set
export MOSTA_NET_REST_ENABLED="${MOSTA_NET_REST_ENABLED:-true}"
export MOSTA_NET_SSE_ENABLED="${MOSTA_NET_SSE_ENABLED:-true}"
export MOSTA_NET_JSONRPC_ENABLED="${MOSTA_NET_JSONRPC_ENABLED:-true}"
export MOSTA_NET_WS_ENABLED="${MOSTA_NET_WS_ENABLED:-true}"

exec node -e "import('./dist/server.js').then(m => m.startServer())"
