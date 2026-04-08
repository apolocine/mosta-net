#!/bin/bash
# @mostajs/net — Test integration replicator (T1 + T3 + T4 + T5 + T6 + T7)
# Demarre un serveur NET en background, execute les tests curl, arrete le serveur
# Author: Dr Hamid MADANI drmdh@msn.com
# Usage: bash scripts/test-replicator-integration.sh
set -e

cd "$(dirname "$0")/.."

PORT=14599
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
echo "══════════════════════════════════════════════════��═════"
echo "  @mostajs/net — Test integration replicator"
echo "════════════════════════════════════════════════════════"
echo ""

# ── T1 — Build ──
echo "T1 — Build"
npx tsc 2>&1
assert "true" "tsc compile sans erreur"
echo ""

# ── Start server ──
echo "▶ Demarrage serveur (port $PORT, SQLite :memory:)..."
DB_DIALECT=sqlite SGBD_URI=:memory: DB_SCHEMA_STRATEGY=create MOSTA_NET_PORT=$PORT \
  MOSTA_NET_REST_ENABLED=true MOSTA_NET_MCP_ENABLED=false \
  MOSTA_NET_GRAPHQL_ENABLED=false MOSTA_NET_WS_ENABLED=false \
  MOSTA_NET_SSE_ENABLED=false MOSTA_NET_JSONRPC_ENABLED=false \
  MOSTA_NET_TRPC_ENABLED=false MOSTA_NET_ODATA_ENABLED=false \
  MOSTA_NET_GRPC_ENABLED=false MOSTA_NET_NATS_ENABLED=false \
  MOSTA_NET_ARROW_ENABLED=false \
  node dist/cli.js serve &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 20); do
  if curl -sf "$BASE/" > /dev/null 2>&1; then break; fi
  sleep 0.5
done

if ! curl -sf "$BASE/" > /dev/null 2>&1; then
  echo "❌ Serveur ne demarre pas"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi
echo "  ✅ Serveur pret (PID $SERVER_PID)"
echo ""

cleanup() {
  kill $SERVER_PID 2>/dev/null
  wait $SERVER_PID 2>/dev/null
}
trap cleanup EXIT

# ── T3 — Serveur avec replicator ──
echo "T3 — Serveur avec replicator"
RES=$(curl -sf "$BASE/api/projects/default/replicas" 2>&1)
assert "$(echo "$RES" | grep -q '\[' && echo true || echo false)" "GET /api/projects/default/replicas → array"
echo ""

# ── T4 — CRUD Replicas ──
echo "T4 — CRUD Replicas"

# Add slave1
RES=$(curl -sf -X POST "$BASE/api/projects/default/replicas" \
  -H "Content-Type: application/json" \
  -d '{"name":"slave1","role":"slave","dialect":"sqlite","uri":":memory:"}' 2>&1)
assert "$(echo "$RES" | grep -q '"ok":true' && echo true || echo false)" "POST add slave1 → ok"

# Add slave2
RES=$(curl -sf -X POST "$BASE/api/projects/default/replicas" \
  -H "Content-Type: application/json" \
  -d '{"name":"slave2","role":"slave","dialect":"sqlite","uri":":memory:"}' 2>&1)
assert "$(echo "$RES" | grep -q '"ok":true' && echo true || echo false)" "POST add slave2 → ok"

# List → 2 replicas
RES=$(curl -sf "$BASE/api/projects/default/replicas" 2>&1)
COUNT=$(echo "$RES" | grep -o '"name"' | wc -l)
assert "$([ "$COUNT" -ge 2 ] && echo true || echo false)" "GET replicas → $COUNT replicas (>=2)"

# Duplicate → 400
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/projects/default/replicas" \
  -H "Content-Type: application/json" \
  -d '{"name":"slave1","role":"slave","dialect":"sqlite","uri":":memory:"}' 2>&1)
assert "$([ "$HTTP" = "400" ] && echo true || echo false)" "POST duplicate slave1 → 400"

# Delete slave2
RES=$(curl -sf -X DELETE "$BASE/api/projects/default/replicas/slave2" 2>&1)
assert "$(echo "$RES" | grep -q '"ok":true' && echo true || echo false)" "DELETE slave2 → ok"

# List → 1 replica
RES=$(curl -sf "$BASE/api/projects/default/replicas" 2>&1)
COUNT=$(echo "$RES" | grep -o '"name"' | wc -l)
assert "$([ "$COUNT" -eq 1 ] && echo true || echo false)" "GET replicas → 1 replica after delete"
echo ""

# ── T5 — Failover ──
echo "T5 — Failover (promote)"

# Promote slave1 to master
RES=$(curl -sf -X POST "$BASE/api/projects/default/replicas/slave1/promote" 2>&1)
assert "$(echo "$RES" | grep -q '"ok":true' && echo true || echo false)" "POST promote slave1 → ok"

# Check slave1 is now master
RES=$(curl -sf "$BASE/api/projects/default/replicas" 2>&1)
assert "$(echo "$RES" | grep -q '"role":"master"' && echo true || echo false)" "slave1 role → master"
echo ""

# ── T6 — Read routing ──
echo "T6 — Read routing"

RES=$(curl -sf -X PUT "$BASE/api/projects/default/read-routing" \
  -H "Content-Type: application/json" \
  -d '{"strategy":"least-lag"}' 2>&1)
assert "$(echo "$RES" | grep -q '"strategy":"least-lag"' && echo true || echo false)" "PUT read-routing least-lag → ok"

RES=$(curl -sf -X PUT "$BASE/api/projects/default/read-routing" \
  -H "Content-Type: application/json" \
  -d '{"strategy":"round-robin"}' 2>&1)
assert "$(echo "$RES" | grep -q '"strategy":"round-robin"' && echo true || echo false)" "PUT read-routing round-robin → ok"
echo ""

# ── T7 — Replication rules ──
echo "T7 — Replication rules"

# Add rule
RES=$(curl -sf -X POST "$BASE/api/replicas/rules" \
  -H "Content-Type: application/json" \
  -d '{"name":"r1","source":"default","target":"default","mode":"snapshot","collections":["users"],"conflictResolution":"source-wins"}' 2>&1)
assert "$(echo "$RES" | grep -q '"ok":true' && echo true || echo false)" "POST add rule r1 → ok"

# List rules
RES=$(curl -sf "$BASE/api/replicas/rules" 2>&1)
assert "$(echo "$RES" | grep -q '"name":"r1"' && echo true || echo false)" "GET rules → has r1"

# Sync
RES=$(curl -sf -X POST "$BASE/api/replicas/rules/r1/sync" 2>&1)
assert "$(echo "$RES" | grep -q '"ok":true' && echo true || echo false)" "POST sync r1 → ok"

# Stats
RES=$(curl -sf "$BASE/api/replicas/rules/r1/stats" 2>&1)
assert "$(echo "$RES" | grep -q '"lastSync"' && echo true || echo false)" "GET stats r1 → has lastSync"

# Delete rule
RES=$(curl -sf -X DELETE "$BASE/api/replicas/rules/r1" 2>&1)
assert "$(echo "$RES" | grep -q '"ok":true' && echo true || echo false)" "DELETE rule r1 → ok"

# List → empty
RES=$(curl -sf "$BASE/api/replicas/rules" 2>&1)
assert "$(echo "$RES" | grep -q '"rules":\[\]' && echo true || echo false)" "GET rules → empty"
echo ""

# ── Summary ──
echo "════════════════════════════════════════════════════════"
echo "  Resultats: $PASSED passed, $FAILED failed"
echo "════════════════════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then exit 1; fi
