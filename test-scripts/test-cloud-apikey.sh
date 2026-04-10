#!/bin/bash
# @mostajs/net — Test cloud middleware API key protection
# Author: Dr Hamid MADANI drmdh@msn.com
# Usage: bash test-scripts/test-cloud-apikey.sh
# Requires: NET running on amia with cloud middleware + portal DB
set -e

SSH_HOST="${1:-amia}"
NET_URL="http://127.0.0.1:14500"
PASSED=0
FAILED=0

assert() {
  if [ "$1" = "$2" ]; then
    PASSED=$((PASSED + 1))
    echo "  ✅ $3"
  else
    FAILED=$((FAILED + 1))
    echo "  ❌ $3 (got: $1, expected: $2)"
  fi
}

run() {
  ssh "$SSH_HOST" "$1" 2>&1 | grep -v "bind\|channel\|forwarding"
}

echo "══════════════════════════════════════════════"
echo "  @mostajs/net — Cloud API Key Protection"
echo "══════════════════════════════════════════════"

# T1 — Dashboard accessible sans clé
echo ""
echo "T1 — Dashboard sans clé"
R=$(run "curl -s -o /dev/null -w '%{http_code}' $NET_URL/")
assert "$R" "200" "Dashboard → 200"

# T2 — Default project sans clé → OK (backward compat)
echo ""
echo "T2 — Default project sans clé"
R=$(run "curl -s -o /dev/null -w '%{http_code}' $NET_URL/api/v1/users")
assert "$R" "200" "GET /api/v1/users → 200"

# T3 — Projet utilisateur sans clé → rejeté
echo ""
echo "T3 — Projet utilisateur sans API key"
BODY=$(run "curl -s $NET_URL/astro-13/api/v1/activities")
echo "$BODY" | grep -q "CLOUD_REJECTED" && R="rejected" || R="allowed"
assert "$R" "rejected" "GET /astro-13/api/v1 sans clé → CLOUD_REJECTED"

# T4 — Projet utilisateur avec clé invalide → rejeté
echo ""
echo "T4 — API key invalide"
BODY=$(run "curl -s -H 'x-api-key: sk_live_fakefake' $NET_URL/astro-13/api/v1/activities")
echo "$BODY" | grep -q "CLOUD_REJECTED\|API_KEY" && R="rejected" || R="allowed"
assert "$R" "rejected" "GET avec clé invalide → rejeté"

# T5 — GET /api/projects (admin) → liste tous
echo ""
echo "T5 — Liste projets (admin)"
COUNT=$(run "curl -s $NET_URL/api/projects | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))'")
echo "  Projets sur NET: $COUNT"
assert "$([ "$COUNT" -gt 0 ] && echo ok || echo fail)" "ok" "GET /api/projects → au moins 1 projet"

echo ""
echo "══════════════════════════════════════════════"
echo "  Resultats: $PASSED passed, $FAILED failed"
echo "══════════════════════════════════════════════"
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
