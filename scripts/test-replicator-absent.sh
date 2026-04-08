#!/bin/bash
# @mostajs/net — Test T2: serveur fonctionne SANS @mostajs/replicator
# Author: Dr Hamid MADANI drmdh@msn.com
# Usage: bash scripts/test-replicator-absent.sh
#
# Ce test verifie que le serveur NET demarre normalement meme si
# @mostajs/replicator n'est pas installe (import conditionnel).
# Pour le tester proprement, renommer temporairement le module.
set -e

cd "$(dirname "$0")/.."

PORT=14598
BASE="http://localhost:$PORT"
PASSED=0
FAILED=0

assert() {
  if [ "$1" = "true" ]; then
    PASSED=$((PASSED + 1))
    echo "  ✅ $2"
  else
    FAILED=$((FAILED + 1))
    echo "  ❌ $2"
  fi
}

echo ""
echo "════════════════════════════════════════════════════════"
echo "  T2 — Serveur NET sans @mostajs/replicator"
echo "════════════════════════════════════════════════════════"
echo ""

# Temporarily hide replicator
REPL_DIR="node_modules/@mostajs/replicator"
REPL_BAK="node_modules/@mostajs/_replicator_bak"

if [ -d "$REPL_DIR" ]; then
  mv "$REPL_DIR" "$REPL_BAK"
  echo "  (replicator masque temporairement)"
fi

restore_replicator() {
  if [ -d "$REPL_BAK" ]; then
    mv "$REPL_BAK" "$REPL_DIR"
    echo "  (replicator restaure)"
  fi
  kill $SERVER_PID 2>/dev/null
  wait $SERVER_PID 2>/dev/null
}
trap restore_replicator EXIT

# Start server
echo "▶ Demarrage serveur sans replicator (port $PORT)..."
DB_DIALECT=sqlite SGBD_URI=:memory: DB_SCHEMA_STRATEGY=create MOSTA_NET_PORT=$PORT \
  MOSTA_NET_REST_ENABLED=true MOSTA_NET_MCP_ENABLED=false \
  MOSTA_NET_GRAPHQL_ENABLED=false MOSTA_NET_WS_ENABLED=false \
  MOSTA_NET_SSE_ENABLED=false MOSTA_NET_JSONRPC_ENABLED=false \
  MOSTA_NET_TRPC_ENABLED=false MOSTA_NET_ODATA_ENABLED=false \
  MOSTA_NET_GRPC_ENABLED=false MOSTA_NET_NATS_ENABLED=false \
  MOSTA_NET_ARROW_ENABLED=false \
  node dist/cli.js serve &
SERVER_PID=$!

for i in $(seq 1 20); do
  if curl -sf "$BASE/" > /dev/null 2>&1; then break; fi
  sleep 0.5
done

if ! curl -sf "$BASE/" > /dev/null 2>&1; then
  echo "❌ Serveur ne demarre pas sans replicator"
  exit 1
fi

assert "true" "Serveur demarre sans replicator"

# REST still works
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/projects" 2>&1)
assert "$([ "$HTTP" = "200" ] && echo true || echo false)" "GET /api/projects → 200"

# Replicas routes should not exist (404 or 500)
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/projects/default/replicas" 2>&1)
assert "$([ "$HTTP" != "200" ] && echo true || echo false)" "GET /api/projects/default/replicas → $HTTP (not 200)"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Resultats: $PASSED passed, $FAILED failed"
echo "════════════════════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then exit 1; fi
