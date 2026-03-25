#!/bin/bash
# Author: Dr Hamid MADANI drmdh@msn.com
# Start @mostajs/net server with SecuAccessPro schemas
# Usage: ./start-net.sh [port]
#
# Prerequisites: npm install @mostajs/net @mostajs/orm
# The server exposes all 15 SecuAccessPro entities via REST, SSE, WS, JSON-RPC
set -euo pipefail

PORT="${1:-4488}"

cd "$(dirname "$0")"

export DB_DIALECT="${DB_DIALECT:-postgres}"
export SGBD_URI="${SGBD_URI:-postgresql://devuser:devpass26@localhost:5432/astro_10_}"
export DB_SCHEMA_STRATEGY="${DB_SCHEMA_STRATEGY:-none}"
export DB_SHOW_SQL="${DB_SHOW_SQL:-true}"
export DB_FORMAT_SQL="${DB_FORMAT_SQL:-true}"
export DB_HIGHLIGHT_SQL="${DB_HIGHLIGHT_SQL:-true}"
export DB_POOL_SIZE="${DB_POOL_SIZE:-20}"

export MOSTA_NET_PORT="$PORT"
export MOSTA_NET_REST_ENABLED="${MOSTA_NET_REST_ENABLED:-true}"
export MOSTA_NET_SSE_ENABLED="${MOSTA_NET_SSE_ENABLED:-true}"
export MOSTA_NET_JSONRPC_ENABLED="${MOSTA_NET_JSONRPC_ENABLED:-true}"
export MOSTA_NET_WS_ENABLED="${MOSTA_NET_WS_ENABLED:-true}"

echo ""
echo "  Starting @mostajs/net on port $PORT"
echo "  Dialect: $DB_DIALECT"
echo "  DB: $SGBD_URI"
echo ""

exec npx tsx net-server.mjs
