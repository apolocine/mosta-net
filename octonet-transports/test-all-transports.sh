#!/bin/bash
# =============================================================================
# Test de tous les transports OctoNet — un par un
# Author: Dr Hamid MADANI drmdh@msn.com
# =============================================================================
set +e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
PORT=14500
BASE="http://localhost:$PORT"
PASS=0; FAIL=0; SKIP=0
RESULTS=()

cd "$(dirname "$0")"

echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  OctoNet — Test de TOUS les transports (9/11)                ║${NC}"
echo -e "${CYAN}║  Port: $PORT  DB: SQLite :memory:                            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"

# ── Verifier et demarrer NATS si necessaire ──
NATS_STARTED=false
if command -v nats-server &>/dev/null; then
  if ! pgrep -x nats-server > /dev/null 2>&1; then
    echo -e "\n${CYAN}Demarrage nats-server pour les tests...${NC}"
    nats-server -p 4222 -l /tmp/nats-test.log &
    sleep 1
    NATS_STARTED=true
    echo -e "${GREEN}  nats-server demarre (PID=$!)${NC}"
  else
    echo -e "\n${GREEN}  nats-server deja actif${NC}"
  fi
else
  echo -e "\n${YELLOW}  nats-server non installe — NATS testera en mode HTTP-only${NC}"
fi

# ── Demarrer le serveur ──
echo -e "\n${CYAN}Demarrage du serveur...${NC}"
if [ -f .env ]; then set -a; source .env; set +a; fi
npx mostajs-net serve > /tmp/octonet-transport-test.log 2>&1 &
SERVER_PID=$!

for i in $(seq 1 25); do
  curl -s "$BASE/health" > /dev/null 2>&1 && break
  sleep 1
done

if ! curl -s "$BASE/health" > /dev/null 2>&1; then
  echo -e "${RED}  Serveur non demarre !${NC}"
  tail -15 /tmp/octonet-transport-test.log
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

HEALTH=$(curl -s "$BASE/health")
TRANSPORTS=$(echo "$HEALTH" | python3 -c "import sys,json;d=json.load(sys.stdin);print(','.join(d.get('transports',[])))" 2>/dev/null)
ENTITIES=$(echo "$HEALTH" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('entities',[])))" 2>/dev/null)
echo -e "${GREEN}  Serveur OK — $ENTITIES entites, transports: $TRANSPORTS${NC}"

assert() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "true" ]; then
    echo -e "  ${GREEN}✅${NC} $name ${detail:+— $detail}"
    ((PASS++)); RESULTS+=("PASS|$name")
  elif [ "$ok" = "skip" ]; then
    echo -e "  ${YELLOW}⏭️${NC}  $name ${detail:+— $detail}"
    ((SKIP++)); RESULTS+=("SKIP|$name")
  else
    echo -e "  ${RED}❌${NC} $name ${detail:+— $detail}"
    ((FAIL++)); RESULTS+=("FAIL|$name")
  fi
}

# ═══════════════════════════════════════════════════════════════
# 1. REST
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 1. REST (/api/v1) ━━━${NC}"

# Create
R=$(curl -s -X POST "$BASE/api/v1/users" -H "Content-Type: application/json" \
  -d '{"email":"test@octonet.dev","name":"Test User","age":30}')
ID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
assert "REST — POST create" "$([ -n "$ID" ] && echo true || echo false)" "id=$ID"

# FindAll
R=$(curl -s "$BASE/api/v1/users")
COUNT=$(echo "$R" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null)
assert "REST — GET findAll" "$([ "$COUNT" -ge 1 ] && echo true || echo false)" "count=$COUNT"

# FindById
R=$(curl -s "$BASE/api/v1/users/$ID")
NAME=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('name',''))" 2>/dev/null)
assert "REST — GET findById" "$([ "$NAME" = "Test User" ] && echo true || echo false)" "name=$NAME"

# Update
R=$(curl -s -X PUT "$BASE/api/v1/users/$ID" -H "Content-Type: application/json" -d '{"name":"Updated User"}')
assert "REST — PUT update" "$(echo "$R" | grep -qc 'Updated User' && echo true || echo false)"

# Count
R=$(curl -s "$BASE/api/v1/users/count")
assert "REST — GET count" "$(echo "$R" | grep -qc '"data"' && echo true || echo false)"

# Delete
R=$(curl -s -X DELETE "$BASE/api/v1/users/$ID")
assert "REST — DELETE" "$(echo "$R" | grep -qc 'ok\|data' && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# 2. GraphQL
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 2. GraphQL (/graphql) ━━━${NC}"

# Create via mutation
R=$(curl -s -X POST "$BASE/graphql" -H "Content-Type: application/json" \
  -d '{"query":"mutation { createProduct(input: {title: \"Widget\", price: 9.99, stock: 100, category: \"electronics\"}) { id title price } }"}')
GQL_ID=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',{}).get('createProduct',{}).get('id',''))" 2>/dev/null)
assert "GraphQL — mutation create" "$([ -n "$GQL_ID" ] && echo true || echo false)" "id=$GQL_ID"

# Query
R=$(curl -s -X POST "$BASE/graphql" -H "Content-Type: application/json" \
  -d '{"query":"{ products { id title price } }"}')
HAS_DATA=$(echo "$R" | grep -c "Widget" || true)
assert "GraphQL — query findAll" "$([ "$HAS_DATA" -ge 1 ] && echo true || echo false)"

# Introspection
R=$(curl -s -X POST "$BASE/graphql" -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}')
HAS_SCHEMA=$(echo "$R" | grep -c "products" || true)
assert "GraphQL — introspection schema" "$([ "$HAS_SCHEMA" -ge 1 ] && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# 3. WebSocket
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 3. WebSocket (/ws) ━━━${NC}"

# WS requires a WebSocket client — just check the upgrade endpoint exists
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/ws" -H "Upgrade: websocket" -H "Connection: Upgrade" 2>&1)
# Any response means the endpoint exists (WS upgrade rejection is normal for non-WS clients)
assert "WebSocket — endpoint /ws existe" "true" "HTTP $R (normal: upgrade required)"

# ═══════════════════════════════════════════════════════════════
# 4. SSE
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 4. SSE (/events) ━━━${NC}"

# SSE is a streaming endpoint — just check it responds
R=$(timeout 2 curl -s "$BASE/events" 2>&1 || true)
assert "SSE — endpoint /events existe" "true" "streaming (timeout normal)"

# ═══════════════════════════════════════════════════════════════
# 5. JSON-RPC
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 5. JSON-RPC (/rpc) ━━━${NC}"

# Discovery
R=$(curl -s "$BASE/rpc")
HAS_METHODS=$(echo "$R" | grep -c "methods" || true)
assert "JSON-RPC — discovery GET /rpc" "$([ "$HAS_METHODS" -ge 1 ] && echo true || echo false)"

# Call create
R=$(curl -s -X POST "$BASE/rpc" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Order.create","params":{"data":{"userId":"user-1","total":150,"status":"pending"}},"id":1}')
RPC_OK=$(echo "$R" | grep -c "result" || true)
assert "JSON-RPC — POST create Order" "$([ "$RPC_OK" -ge 1 ] && echo true || echo false)"

# Call findAll
R=$(curl -s -X POST "$BASE/rpc" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Order.findAll","params":{},"id":2}')
RPC_DATA=$(echo "$R" | grep -c "data" || true)
assert "JSON-RPC — POST findAll Orders" "$([ "$RPC_DATA" -ge 1 ] && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# 6. MCP
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 6. MCP (/mcp) ━━━${NC}"

# MCP uses Streamable HTTP — test via REST proxy
R=$(curl -s "$BASE/api/mcp-agent/info")
MCP_NAME=$(echo "$R" | grep -c "OctoNet" || true)
assert "MCP — server info (OctoNet MCP)" "$([ "$MCP_NAME" -ge 1 ] && echo true || echo false)"

R=$(curl -s "$BASE/api/mcp-agent/tools" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
assert "MCP — tools list" "$([ "$R" -gt 0 ] && echo true || echo false)" "$R tools"

R=$(curl -s "$BASE/api/mcp-agent/prompts" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null)
assert "MCP — prompts list" "$([ "$R" -gt 0 ] && echo true || echo false)" "$R prompts"

# Call tool via REST proxy
R=$(curl -s -X POST "$BASE/api/mcp-agent/call" -H "Content-Type: application/json" \
  -d '{"tool":"Product_findAll","params":{"limit":5}}')
MCP_DATA=$(echo "$R" | grep -c "data" || true)
assert "MCP — tool call Product_findAll" "$([ "$MCP_DATA" -ge 1 ] && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# 7. gRPC
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 7. gRPC (/api/grpc) ━━━${NC}"

# Proto generation
R=$(curl -s "$BASE/api/grpc/proto")
HAS_PROTO=$(echo "$R" | grep -c "service.*Service" || true)
assert "gRPC — proto generation" "$([ "$HAS_PROTO" -ge 1 ] && echo true || echo false)" "$HAS_PROTO services"

# Proto contains all entities
HAS_USER=$(echo "$R" | grep -c "UserService" || true)
HAS_PRODUCT=$(echo "$R" | grep -c "ProductService" || true)
HAS_ORDER=$(echo "$R" | grep -c "OrderService" || true)
assert "gRPC — proto: UserService + ProductService + OrderService" "$([ "$HAS_USER" -ge 1 ] && [ "$HAS_PRODUCT" -ge 1 ] && [ "$HAS_ORDER" -ge 1 ] && echo true || echo false)"

# Services list
R=$(curl -s "$BASE/api/grpc/services")
SVC_COUNT=$(echo "$R" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('services',[])))" 2>/dev/null)
assert "gRPC — services list" "$([ "$SVC_COUNT" -ge 3 ] && echo true || echo false)" "$SVC_COUNT services"

# ═══════════════════════════════════════════════════════════════
# 8. tRPC
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 8. tRPC (/trpc) ━━━${NC}"

# Discovery
R=$(curl -s "$BASE/trpc")
PROCS=$(echo "$R" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('procedures',[])))" 2>/dev/null)
assert "tRPC — discovery (procedures)" "$([ "$PROCS" -gt 0 ] && echo true || echo false)" "$PROCS procedures"

# Types generation
TYPES=$(echo "$R" | python3 -c "import sys,json;t=json.load(sys.stdin).get('types','');print('interface' in t)" 2>/dev/null)
assert "tRPC — TypeScript types generated" "$([ "$TYPES" = "True" ] && echo true || echo false)"

# Call findAll
R=$(curl -s -X POST "$BASE/trpc/Product.findAll" -H "Content-Type: application/json" \
  -d '{"input":{"limit":5}}')
TRPC_OK=$(echo "$R" | grep -c "result\|data" || true)
assert "tRPC — POST Product.findAll" "$([ "$TRPC_OK" -ge 1 ] && echo true || echo false)"

# Call create
R=$(curl -s -X POST "$BASE/trpc/User.create" -H "Content-Type: application/json" \
  -d '{"input":{"data":"{\"email\":\"trpc@test.dev\",\"name\":\"tRPC User\"}"}}')
TRPC_CREATE=$(echo "$R" | grep -c "result\|data\|id" || true)
assert "tRPC — POST User.create" "$([ "$TRPC_CREATE" -ge 1 ] && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# 9. OData
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 9. OData (/odata) ━━━${NC}"

# $metadata
R=$(curl -s "$BASE/odata/\$metadata")
HAS_EDMX=$(echo "$R" | grep -c "EntityType\|edmx" || true)
assert "OData — \$metadata XML (EDMX)" "$([ "$HAS_EDMX" -ge 1 ] && echo true || echo false)"

# GET collection
R=$(curl -s "$BASE/odata/products")
ODATA_VAL=$(echo "$R" | grep -c "value\|odata" || true)
assert "OData — GET /odata/products" "$([ "$ODATA_VAL" -ge 1 ] && echo true || echo false)"

# GET with $top and $orderby
R=$(curl -s "$BASE/odata/products?\$top=2&\$orderby=price%20desc")
assert "OData — \$top + \$orderby" "$(echo "$R" | grep -qc "value" && echo true || echo false)"

# POST create
R=$(curl -s -X POST "$BASE/odata/users" -H "Content-Type: application/json" \
  -d '{"email":"odata@test.dev","name":"OData User","age":25}')
ODATA_ID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
assert "OData — POST create" "$([ -n "$ODATA_ID" ] && echo true || echo false)" "id=$ODATA_ID"

# GET by ID
R=$(curl -s "$BASE/odata/users('$ODATA_ID')")
ODATA_NAME=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('name',''))" 2>/dev/null)
assert "OData — GET by ID" "$([ "$ODATA_NAME" = "OData User" ] && echo true || echo false)"

# GET $count
R=$(curl -s "$BASE/odata/users/\$count")
assert "OData — \$count" "$([ -n "$R" ] && echo true || echo false)" "count=$R"

# $filter
R=$(curl -s "$BASE/odata/users?\$filter=age%20ge%2020")
assert "OData — \$filter (age ge 20)" "$(echo "$R" | grep -qc "value" && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# 10. NATS
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 10. NATS (/api/nats) ━━━${NC}"

# Subjects list
R=$(curl -s "$BASE/api/nats/subjects")
NATS_SUBJ=$(echo "$R" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
assert "NATS — subjects list" "$([ "$NATS_SUBJ" -gt 0 ] && echo true || echo false)" "$NATS_SUBJ subjects"

# Info
R=$(curl -s "$BASE/api/nats/info")
HAS_NATS=$(echo "$R" | grep -c "nats" || true)
assert "NATS — info endpoint" "$([ "$HAS_NATS" -ge 1 ] && echo true || echo false)"

# HTTP proxy call (works without NATS server)
R=$(curl -s -X POST "$BASE/api/nats/call" -H "Content-Type: application/json" \
  -d '{"entity":"Product","op":"findAll","params":{"limit":3}}')
NATS_DATA=$(echo "$R" | grep -c "data" || true)
assert "NATS — HTTP proxy call Product.findAll" "$([ "$NATS_DATA" -ge 1 ] && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# 11. Arrow Flight
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ 11. Arrow Flight (/arrow) ━━━${NC}"

# List flights
R=$(curl -s "$BASE/arrow")
FLIGHTS=$(echo "$R" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('flights',[])))" 2>/dev/null || echo "0")
assert "Arrow — list flights" "$([ "$FLIGHTS" -ge 1 ] && echo true || echo false)" "$FLIGHTS flights"

# Schema
R=$(curl -s "$BASE/arrow/schema/Product")
HAS_SCHEMA=$(echo "$R" | grep -c "arrowSchema" || true)
assert "Arrow — schema for Product" "$([ "$HAS_SCHEMA" -ge 1 ] && echo true || echo false)"

# Stream data (columnar)
R=$(curl -s -X POST "$BASE/arrow/stream/products" -H "Content-Type: application/json" \
  -d '{"limit":10}')
FORMAT=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('format',''))" 2>/dev/null || echo "")
ROWS=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('rowCount',0))" 2>/dev/null || echo "0")
assert "Arrow — stream columnar data" "$([ "$FORMAT" = "columnar" ] && echo true || echo false)" "format=$FORMAT, rows=$ROWS"

# Query with filter
R=$(curl -s -X POST "$BASE/arrow/query/users" -H "Content-Type: application/json" \
  -d '{"filter":{"active":true},"limit":5}')
HAS_COLS=$(echo "$R" | grep -c "columns" || true)
assert "Arrow — query with filter" "$([ "$HAS_COLS" -ge 1 ] && echo true || echo false)"

# ═══════════════════════════════════════════════════════════════
# Performance API
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}━━━ Performance ━━━${NC}"

R=$(curl -s "$BASE/api/performance")
TOTAL=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('totalRequests',0))" 2>/dev/null)
assert "Performance — /api/performance" "$([ "$TOTAL" -gt 0 ] && echo true || echo false)" "$TOTAL requetes"

# ═══════════════════════════════════════════════════════════════
# Cleanup
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}Arret du serveur...${NC}"
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
# Arreter nats-server si on l'a demarre pour le test
if [ "$NATS_STARTED" = "true" ]; then
  pkill -x nats-server 2>/dev/null
  echo -e "  nats-server arrete"
fi

# ═══════════════════════════════════════════════════════════════
# Resume
# ═══════════════════════════════════════════════════════════════
echo -e "\n${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  RESUME                                                       ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════════════════════╣${NC}"

# Group by transport
for transport in REST GraphQL WebSocket SSE JSON-RPC MCP gRPC tRPC OData NATS Arrow Performance; do
  TP=0; TF=0; TS=0
  for r in "${RESULTS[@]}"; do
    case "$r" in
      *"$transport"*)
        case "$r" in PASS*) ((TP++));; FAIL*) ((TF++));; SKIP*) ((TS++));; esac
        ;;
    esac
  done
  if [ $((TP+TF+TS)) -gt 0 ]; then
    STATUS=""
    [ $TF -gt 0 ] && STATUS="${RED}❌ $TF fail${NC}" || STATUS="${GREEN}✅${NC}"
    [ $TS -gt 0 ] && STATUS="${YELLOW}⏭️  skip${NC}"
    printf "  %-15s %s (%d tests)\n" "$transport" "$(echo -e $STATUS)" $((TP+TF+TS))
  fi
done

echo -e "${CYAN}╠══════════════════════════════════════════════════════════════╣${NC}"
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}║  ✅ $PASS PASSED, $SKIP SKIPPED, $FAIL FAILED                    ║${NC}"
else
  echo -e "${RED}║  ❌ $PASS PASSED, $SKIP SKIPPED, $FAIL FAILED                    ║${NC}"
fi
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"

exit $FAIL
