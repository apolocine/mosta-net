#!/bin/bash
# @mostajs/net — Test T9: IHM onglet Replicas existe dans le dashboard
# Author: Dr Hamid MADANI drmdh@msn.com
# Usage: bash scripts/test-replicator-ihm.sh
# Prerequis: serveur NET en cours sur le port specifie
set -e

cd "$(dirname "$0")/.."

PORT=${1:-14599}
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
echo "  T9 — IHM Dashboard: onglet Replicas"
echo "════════════════════════════════════════════════════════"
echo ""

# Start server in background
echo "▶ Demarrage serveur (port $PORT)..."
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
cleanup() { kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null; }
trap cleanup EXIT

if ! curl -sf "$BASE/" > /dev/null 2>&1; then
  echo "❌ Serveur ne demarre pas"
  exit 1
fi
echo "  ✅ Serveur pret"
echo ""

# Fetch dashboard HTML
HTML=$(curl -sf "$BASE/" 2>&1)

# T9.1 — Onglet Replicas dans la navigation
assert "$(echo "$HTML" | grep -q "showTab('replicas')" && echo true || echo false)" "Nav tab 'Replicas' present"

# T9.2 — Tab content tab-replicas
assert "$(echo "$HTML" | grep -q 'id="tab-replicas"' && echo true || echo false)" "Tab content #tab-replicas present"

# T9.3 — Dropdown projet pour replicas
assert "$(echo "$HTML" | grep -q 'id="replicaProject"' && echo true || echo false)" "Dropdown #replicaProject present"

# T9.4 — Tableau replicas
assert "$(echo "$HTML" | grep -q 'id="replicasBody"' && echo true || echo false)" "Table body #replicasBody present"

# T9.5 — Formulaire ajout replica
assert "$(echo "$HTML" | grep -q 'id="addReplicaForm"' && echo true || echo false)" "Form #addReplicaForm present"

# T9.6 — Read routing radios
assert "$(echo "$HTML" | grep -q 'name="routing"' && echo true || echo false)" "Radio buttons routing present"

# T9.7 — Section rules
assert "$(echo "$HTML" | grep -q 'id="rulesBody"' && echo true || echo false)" "Table body #rulesBody present"

# T9.8 — JS functions present
assert "$(echo "$HTML" | grep -q 'function loadReplicas' && echo true || echo false)" "JS function loadReplicas() present"
assert "$(echo "$HTML" | grep -q 'function addReplicaSubmit' && echo true || echo false)" "JS function addReplicaSubmit() present"
assert "$(echo "$HTML" | grep -q 'function promoteReplica' && echo true || echo false)" "JS function promoteReplica() present"
assert "$(echo "$HTML" | grep -q 'function setRouting' && echo true || echo false)" "JS function setRouting() present"
assert "$(echo "$HTML" | grep -q 'function loadRules' && echo true || echo false)" "JS function loadRules() present"
assert "$(echo "$HTML" | grep -q 'function syncRule' && echo true || echo false)" "JS function syncRule() present"

# T9.9 — All 6 nav tabs present
TABS=$(echo "$HTML" | grep -o "showTab(" | wc -l)
assert "$([ "$TABS" -ge 6 ] && echo true || echo false)" "6 nav tabs present ($TABS found)"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Resultats: $PASSED passed, $FAILED failed"
echo "════════════════════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then exit 1; fi
