#!/bin/bash
# Demarre le serveur OctoNet avec tous les transports
# Verifie et installe NATS si necessaire
# Author: Dr Hamid MADANI drmdh@msn.com
set -uo pipefail
cd "$(dirname "$0")"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

if [ -f .env ]; then set -a; source .env; set +a; fi

echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  OctoNet Transports Test Server                    ${NC}"
echo -e "${CYAN}  Port: ${MOSTA_NET_PORT:-14500}  DB: ${DB_DIALECT:-sqlite}     ${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"

# ── Verifier NATS ──
if [ "${MOSTA_NET_NATS_ENABLED:-false}" = "true" ]; then
  echo -e "\n${CYAN}Verification NATS...${NC}"

  # Verifier si nats-server est installe
  if ! command -v nats-server &>/dev/null; then
    echo -e "${YELLOW}  nats-server non installe.${NC}"
    read -rp "  Installer nats-server ? (o/N) : " confirm
    if [ "$confirm" = "o" ] || [ "$confirm" = "O" ]; then
      NATS_VERSION="2.10.24"
      ARCH=$(uname -m)
      [ "$ARCH" = "x86_64" ] && ARCH="amd64"
      [ "$ARCH" = "aarch64" ] && ARCH="arm64"
      echo -e "  ${CYAN}Telechargement nats-server v${NATS_VERSION}...${NC}"
      cd /tmp
      curl -sL "https://github.com/nats-io/nats-server/releases/download/v${NATS_VERSION}/nats-server-v${NATS_VERSION}-linux-${ARCH}.tar.gz" -o nats-server.tar.gz
      tar xzf nats-server.tar.gz
      sudo cp "nats-server-v${NATS_VERSION}-linux-${ARCH}/nats-server" /usr/local/bin/
      rm -rf nats-server.tar.gz "nats-server-v${NATS_VERSION}-linux-${ARCH}"
      cd "$(dirname "$0")"
      echo -e "  ${GREEN}nats-server installe: $(nats-server --version 2>&1 | head -1)${NC}"
    else
      echo -e "  ${YELLOW}NATS desactive — le transport fonctionnera en mode HTTP-only${NC}"
    fi
  fi

  # Verifier si nats-server tourne
  if command -v nats-server &>/dev/null; then
    if ! pgrep -x nats-server > /dev/null 2>&1; then
      echo -e "  ${YELLOW}nats-server installe mais pas demarre.${NC}"
      read -rp "  Demarrer nats-server sur le port 4222 ? (o/N) : " confirm
      if [ "$confirm" = "o" ] || [ "$confirm" = "O" ]; then
        nats-server -p 4222 -l /tmp/nats-server.log &
        NATS_PID=$!
        sleep 1
        if kill -0 $NATS_PID 2>/dev/null; then
          echo -e "  ${GREEN}nats-server demarre (PID=$NATS_PID, port 4222)${NC}"
        else
          echo -e "  ${RED}nats-server n'a pas demarre — verifiez /tmp/nats-server.log${NC}"
        fi
      fi
    else
      NATS_PID=$(pgrep -x nats-server | head -1)
      echo -e "  ${GREEN}nats-server deja en cours (PID=$NATS_PID)${NC}"
    fi
  fi
fi

# ── Arrow Flight : pas de serveur externe necessaire ──
if [ "${MOSTA_NET_ARROW_ENABLED:-false}" = "true" ]; then
  echo -e "\n${CYAN}Arrow Flight...${NC}"
  echo -e "  ${GREEN}Arrow Flight utilise le HTTP endpoint integre — pas de serveur externe${NC}"
fi

# ── Demarrer OctoNet ──
echo -e "\n${CYAN}Demarrage OctoNet NET...${NC}\n"

while true; do
  npx mostajs-net serve
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    echo -e "\n  ${RED}Serveur arrete (code $EXIT_CODE)${NC}"
    # Arreter nats-server si on l'a demarre
    [ -n "${NATS_PID:-}" ] && kill $NATS_PID 2>/dev/null
    exit $EXIT_CODE
  fi
  echo -e "\n  ${CYAN}Redemarrage automatique...${NC}\n"
  sleep 1
done
