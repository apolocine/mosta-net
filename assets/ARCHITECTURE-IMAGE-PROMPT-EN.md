# Prompt — EN version of the "socket board" architecture image

**Author** : Dr Hamid MADANI <drmdh@msn.com>
**Date** : 2026-06-04
**Goal** : regenerate `assets/architecture-orm-net-netclient.png` with **English
labels** (the current asset is in French). Same photoreal "electrical sockets"
metaphor. Also fixes the database/transport lists to the **real** values.

> Image models often blur tiny text. For pixel-perfect labels, an alternative is
> to **edit the existing FR image's text layer** in an editor. The prompt below
> is for a full regeneration.

---

## Main prompt (EN)

```
Photorealistic 3D product render, infographic, of physical electrical socket
panels mounted on a dark textured wall. German Schuko-style sockets, braided
cables, soft studio lighting, crisp labels, clean technical poster, 3:2.

Top-left: a vertical list of 13 database names, each a small icon with a blue
cable running rightward into a panel:
PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, CockroachDB,
Google Cloud Spanner, IBM Db2, SAP HANA, Sybase, HSQLDB, MongoDB.

Panel A (upper-left center): a socket box labeled "ORM (mosta-orm)", with a
female socket, subtitle "Female socket — connects to 13 databases", green LED.

A horizontal cable labeled "Electrical wiring (ORM <-> NET link)" connects
panel A to panel B.

Panel B (upper-right center): a socket box labeled "NET / Octonet (mosta-net)",
female socket, subtitle "Female socket — connects to 11 transport types",
green LED. On its right, 11 cables to labels:
REST, GraphQL, WebSocket, gRPC, tRPC, SSE, MCP, OData, Arrow Flight,
JSON-RPC, NATS.

Center: a box labeled "Data-Plug (universal male plug)" with a male plug and
green LED, wired up to both panel A and panel B, and to the right toward an
"External application (e.g. refrigerator)" — a modern fridge icon.

Bottom center: a box labeled "NetClient (REST, GraphQL, gRPC, ...)", subtitle
"NetClient box — gateway for 18 languages".

Bottom row: 18 numbered "language sockets", each a small language logo:
TypeScript, JavaScript, Python, Java, C#, .NET, PHP, Go, Rust, C, C++, Kotlin,
Swift, Dart, Ruby, R, Elixir, Lua. Left label: "18 Languages (language sockets)".

Bottom strip — LEGEND: "Female socket (receives the connection)",
"Male plug (provides the connection)", "Electrical wiring / power",
"Network connection / protocol". And FLOW SUMMARY:
1. ORM <-> NET linked by electrical wiring.
2. Data-Plug connects ORM, NET and the external app.
3. The 18 languages go through NetClient to reach NET (REST, GraphQL, gRPC, ...).

Minimal, legible English labels, no gibberish text, balanced composition,
poster-quality, high resolution.
```

---

## Label translation table (FR → EN) for fidelity

| FR (image actuelle) | EN |
|---|---|
| Prise femelle / Connexion à 13 SGBD | Female socket / Connects to 13 databases |
| Connexion à 11 types de transport | Connects to 11 transport types |
| Raccordement électrique (liaison ORM ↔ NET) | Electrical wiring (ORM ↔ NET link) |
| Data-Plug (Prise mâle universelle) | Data-Plug (universal male plug) |
| Application externe (Ex: Frigidaire) | External application (e.g. refrigerator) |
| Boîte NetClient (Passerelle des 18 langages) | NetClient box (gateway for 18 languages) |
| 18 Langages (Prises électriques de langage) | 18 Languages (language sockets) |
| LÉGENDE | LEGEND |
| Prise femelle (reçoit la connexion) | Female socket (receives the connection) |
| Prise mâle (fournit la connexion) | Male plug (provides the connection) |
| Raccordement électrique / alimentation | Electrical wiring / power |
| Connexion réseau / protocole | Network connection / protocol |
| RÉSUMÉ DU FLUX | FLOW SUMMARY |

## Corrections vs l'image FR

- **Bases** : remplacer Cassandra, Redis, Elasticsearch, Firebird, Microsoft
  Access (illustratifs) par les **13 réels** : PostgreSQL, MySQL, MariaDB,
  SQLite, SQL Server, Oracle, CockroachDB, Google Cloud Spanner, IBM Db2,
  SAP HANA, Sybase, HSQLDB, MongoDB.
- **Transports** : utiliser les **11 canoniques** d'Octonet (`TRANSPORT_NAMES`)
  : REST, GraphQL, WebSocket, gRPC, tRPC, SSE, MCP, OData, Arrow Flight,
  JSON-RPC, NATS — plutôt que MQTT/AMQP/FTP/SMTP/CoAP/UDP/Serial.

> Une fois l'image EN générée, la déposer ici en `architecture-orm-net-netclient-en.png`
> (ou écraser le `.png` existant) ; je mets à jour le `<img src>` du README et je pousse.
