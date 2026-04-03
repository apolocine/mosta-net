#!/bin/bash
# Author: Dr Hamid MADANI drmdh@msn.com
# Start @mostajs/net server with SecuAccessPro schemas
# Usage: ./start-net.sh [port]
#
# Prerequisites: npm install @mostajs/net @mostajs/orm
# The server exposes all 15 SecuAccessPro entities via REST, SSE, WS, JSON-RPC
Bash(chmod +x /home/hmd/dev/MostaGare-Install/SecuAccessPro/start-net.sh)
  ⎿  Done

● Prêt. Usage :

  # Démarrage par défaut (port 4488, postgres)
  ./start-net.sh

  # Port custom
  ./start-net.sh 5000

  # Avec Oracle
  DB_DIALECT=oracle
  SGBD_URI="oracle://devuser:devpass26@localhost:1521/XEPDB1" ./start-net.sh

  # Avec MongoDB
  DB_DIALECT=mongodb SGBD_URI="mongodb://localhost:27017/astro_10_"
  ./start-net.sh

