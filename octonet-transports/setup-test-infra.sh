#!/bin/bash
# Setup infrastructure de test pour NATS et Arrow Flight
# Installe nats-server localement (binaire standalone, pas Docker)
# Author: Dr Hamid MADANI drmdh@msn.com
set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Setup infrastructure de test NATS                  ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"

# NATS Server
NATS_VERSION="2.10.24"
NATS_DIR="/usr/local/bin"

if command -v nats-server &>/dev/null; then
  echo -e "${GREEN}  nats-server deja installe:${NC} $(nats-server --version 2>&1 | head -1)"
else
  echo -e "\n${CYAN}Installation nats-server v${NATS_VERSION}...${NC}"
  ARCH=$(uname -m)
  [ "$ARCH" = "x86_64" ] && ARCH="amd64"
  [ "$ARCH" = "aarch64" ] && ARCH="arm64"

  NATS_URL="https://github.com/nats-io/nats-server/releases/download/v${NATS_VERSION}/nats-server-v${NATS_VERSION}-linux-${ARCH}.tar.gz"

  cd /tmp
  curl -sL "$NATS_URL" -o nats-server.tar.gz
  tar xzf nats-server.tar.gz
  sudo cp "nats-server-v${NATS_VERSION}-linux-${ARCH}/nats-server" "$NATS_DIR/"
  rm -rf nats-server.tar.gz "nats-server-v${NATS_VERSION}-linux-${ARCH}"

  echo -e "${GREEN}  nats-server installe:${NC} $(nats-server --version 2>&1 | head -1)"
fi

echo -e "\n${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Infrastructure prete !${NC}"
echo -e "${GREEN}${NC}"
echo -e "${GREEN}  Demarrer NATS:${NC}"
echo -e "${GREEN}    nats-server -p 4222 &${NC}"
echo -e "${GREEN}${NC}"
echo -e "${GREEN}  Arrow Flight: utilise le HTTP endpoint integre${NC}"
echo -e "${GREEN}  (pas besoin de serveur externe)${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
