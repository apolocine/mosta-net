#!/bin/bash
# Author: Dr Hamid MADANI drmdh@msn.com
# Test: @mostajs/net dashboard + REST API + ornetadmin embed
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NET_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${1:-4499}"
DB_FILE=$(mktemp /tmp/test-net-dash-XXXXXX.db)
SERVER_PID=""
trap "rm -f $DB_FILE; [ -n \"$SERVER_PID\" ] && kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null" EXIT

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}✗${NC} $1 — $2"; }

echo -e "\n${CYAN}════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Test @mostajs/net Dashboard + REST API${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}\n"

cd "$NET_DIR"

# Create test script that registers schemas and starts server
cat > "$NET_DIR/tests-scripts/_test-server.mjs" << TESTEOF
import { registerSchemas } from '@mostajs/orm';
import { startServer } from '../dist/index.js';

const UserSchema = {
  name: 'NetUser', collection: 'net_users',
  fields: { name: { type: 'string', required: true }, email: { type: 'string', required: true } },
  relations: {}, indexes: [], timestamps: true,
};
const ActivitySchema = {
  name: 'NetActivity', collection: 'net_activities',
  fields: { name: { type: 'string', required: true }, slug: { type: 'string', required: true } },
  relations: {}, indexes: [], timestamps: true,
};

registerSchemas([UserSchema, ActivitySchema]);
await startServer();
TESTEOF

# Start server
DB_DIALECT=sqlite \
SGBD_URI="$DB_FILE" \
DB_SCHEMA_STRATEGY=create \
MOSTA_NET_PORT=$PORT \
MOSTA_NET_REST_ENABLED=true \
MOSTA_NET_SSE_ENABLED=true \
MOSTA_NET_JSONRPC_ENABLED=true \
MOSTA_NET_WS_ENABLED=true \
node "$NET_DIR/tests-scripts/_test-server.mjs" > /tmp/test-net-output.log 2>&1 &
SERVER_PID=$!
sleep 4

BASE="http://localhost:$PORT"

# Test 1: Health
HEALTH=$(curl -s $BASE/health 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then ok "Health endpoint"; else fail "Health" "$HEALTH"; fi

# Test 2: Home page (dashboard HTML)
HOME=$(curl -s $BASE/ 2>/dev/null)
if echo "$HOME" | grep -q '@mostajs/net' && echo "$HOME" | grep -q 'API Explorer'; then
  ok "Dashboard HTML (entities + API Explorer)"
else
  fail "Dashboard HTML" "missing content"
fi

# Test 3: REST findAll (empty)
USERS=$(curl -s $BASE/api/v1/net_users 2>/dev/null)
if echo "$USERS" | grep -q '"data"'; then ok "REST GET /net_users (empty)"; else fail "REST GET" "$USERS"; fi

# Test 4: REST create
CREATED=$(curl -s -X POST $BASE/api/v1/net_users \
  -H "Content-Type: application/json" \
  -d '{"name":"Dr Madani","email":"drmdh@msn.com"}' 2>/dev/null)
if echo "$CREATED" | grep -q '"Dr Madani"'; then ok "REST POST create user"; else fail "REST POST" "$CREATED"; fi

# Extract ID
USER_ID=$(echo "$CREATED" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null || echo "")

# Test 5: REST findById
if [ -n "$USER_ID" ]; then
  FOUND=$(curl -s $BASE/api/v1/net_users/$USER_ID 2>/dev/null)
  if echo "$FOUND" | grep -q '"Dr Madani"'; then ok "REST GET /:id"; else fail "REST GET /:id" "$FOUND"; fi
else
  fail "REST GET /:id" "no user ID"
fi

# Test 6: REST count
COUNT=$(curl -s $BASE/api/v1/net_users/count 2>/dev/null)
if echo "$COUNT" | grep -q '"data":1'; then ok "REST GET /count (1)"; else fail "REST count" "$COUNT"; fi

# Test 7: REST update
if [ -n "$USER_ID" ]; then
  UPDATED=$(curl -s -X PUT $BASE/api/v1/net_users/$USER_ID \
    -H "Content-Type: application/json" \
    -d '{"name":"Dr Hamid MADANI"}' 2>/dev/null)
  if echo "$UPDATED" | grep -q '"Dr Hamid MADANI"'; then ok "REST PUT update"; else fail "REST PUT" "$UPDATED"; fi
fi

# Test 8: REST delete
if [ -n "$USER_ID" ]; then
  DELETED=$(curl -s -X DELETE $BASE/api/v1/net_users/$USER_ID 2>/dev/null)
  if echo "$DELETED" | grep -q '"ok"'; then ok "REST DELETE"; else fail "REST DELETE" "$DELETED"; fi
fi

# Test 9: REST count after delete
COUNT2=$(curl -s $BASE/api/v1/net_users/count 2>/dev/null)
if echo "$COUNT2" | grep -q '"data":0'; then ok "REST count after delete (0)"; else fail "REST count after delete" "$COUNT2"; fi

# Test 10: JSON-RPC discovery
RPC=$(curl -s $BASE/rpc 2>/dev/null)
if echo "$RPC" | grep -q '"methods"'; then ok "JSON-RPC discovery /rpc"; else fail "JSON-RPC" "$RPC"; fi

# Test 11: JSON-RPC findAll
RPC_FIND=$(curl -s -X POST $BASE/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"NetActivity.findAll","params":{},"id":1}' 2>/dev/null)
if echo "$RPC_FIND" | grep -q '"result"'; then ok "JSON-RPC NetActivity.findAll"; else fail "JSON-RPC findAll" "$RPC_FIND"; fi

# Test 12: Terminal logs present
if grep -q "NET:REST" /tmp/test-net-output.log 2>/dev/null; then
  ok "Terminal request logging"
else
  fail "Terminal logging" "no [NET:REST] in logs"
fi

# Test 13: Banner in output
if grep -q "Transports:" /tmp/test-net-output.log 2>/dev/null; then
  ok "Startup banner displayed"
else
  fail "Startup banner" "no banner in logs"
fi

echo ""
echo -e "${CYAN}────────────────────────────────────────────────────────${NC}"
echo -e "  ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}"
echo -e "${CYAN}────────────────────────────────────────────────────────${NC}"

rm -f "$NET_DIR/tests-scripts/_test-server.mjs" /tmp/test-net-output.log
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
