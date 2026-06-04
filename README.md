# @mostajs/net — Octonet

> **One schema, 11 transports, 13 databases, multi-tenant auth — out of the box.**
> Schema-driven multi-protocol API server for the @mostajs ecosystem. Built with TypeScript on Fastify, designed for polyglot consumption (14 native NetClients).

<p align="center">
  <img src="logo/octonet-icon.svg" width="128" alt="Octonet Logo"/>
</p>

[![npm](https://img.shields.io/npm/v/@mostajs/net.svg)](https://www.npmjs.com/package/@mostajs/net)
[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![mcp.so](https://img.shields.io/badge/mcp.so-listed-green.svg)](https://mcp.so/server/octonet-mcp/apolocine)

**Author** : Dr Hamid MADANI \<drmdh@msn.com\>
**Homepage** : [octonet.amia.fr](https://octonet.amia.fr) · [mcp.amia.fr](https://mcp.amia.fr)

---

<p align="center">
  <img src="assets/architecture-orm-net-netclient.png" width="900" alt="Octonet stack as electrical sockets: @mostajs/orm plugs into 13 databases, @mostajs/net (Octonet) re-exposes them over 11 transports, Data-Plug bridges them, and NetClient fans out to 18 language clients consumed by any external app."/>
</p>

> **The socket board.** `@mostajs/orm` connects to **13 databases**; **Octonet**
> (`@mostajs/net`) re-exposes the same entities over **11 transports** (REST,
> WebSocket, gRPC, MQTT, AMQP…); **NetClient** then fans out to **18 language
> clients** — so any external app plugs into your data, in any runtime.

---

## Table of Contents

1. [What is Octonet](#what-is-octonet)
2. [Try in 2 clicks (T1 sandbox)](#try-in-2-clicks-t1-sandbox)
3. [3-tier onboarding model](#3-tier-onboarding-model)
4. [11 transports](#11-transports)
5. [13 databases](#13-databases)
6. [Multi-tenant authentication](#multi-tenant-authentication)
7. [Generic scope registry](#generic-scope-registry)
8. [Multi-project support](#multi-project-support)
9. [Quick start (self-host)](#quick-start-self-host)
10. [Configuration (.env)](#configuration-env)
11. [API endpoints reference](#api-endpoints-reference)
12. [Architecture](#architecture)
13. [Boot sequence](#boot-sequence)
14. [14 polyglot NetClients](#14-polyglot-netclients)
15. [Production deploy (amia.fr)](#production-deploy-amiafr)
16. [License](#license)

---

## What is Octonet

Octonet (`@mostajs/net`) is a Node.js multi-transport server that exposes a single `@mostajs/orm` schema as **11 different network protocols simultaneously** : REST, GraphQL, WebSocket, SSE, JSON-RPC, MCP, gRPC, tRPC, OData, NATS, Arrow Flight.

The same `User` entity is reachable as :

```bash
curl https://octonet.amia.fr/api/v1/User              # REST
curl https://octonet.amia.fr/graphql -d '{"query":...}'  # GraphQL
wscat -c wss://octonet.amia.fr/ws                     # WebSocket
curl -N https://octonet.amia.fr/mcp                   # MCP (Claude Desktop)
# … 7 more
```

Backed by `@mostajs/orm` (13 SGBD dialects). Backed by `@mostajs/rbac` + `@mostajs/auth` + `@mostajs/api-keys` for multi-tenant identity. Backed by `@mostajs/mproject` for multi-project routing.

Octonet is **the second cerebral lobe** of the @mostajs trilogy :
- **#1 — `@mostajs/orm`** : data persistence (13 databases)
- **#2 — Octonet** : multi-protocol transport (11 wire protocols)
- **#3 — NetClients polyglottes** : 14 native client libraries (Java, .NET, Python, Go, Swift, Kotlin, Dart, Rust, PHP, Ruby, Elixir, Lua, Delphi, Unity)

---

## Try in 2 clicks (T1 sandbox)

The fastest way to test Octonet from any of the 14 runtimes :

1. Open [https://octonet.amia.fr/try](https://octonet.amia.fr/try)
2. Pick an alias (e.g. `alice-42`)
3. Get an apikey scoped to your sandbox

```bash
curl -X POST https://octonet.amia.fr/try \
  -H "Content-Type: application/json" \
  -d '{"alias":"alice-42"}'

# Response:
{
  "status": "ok",
  "data": {
    "alias": "alice-42",
    "projectSlug": "sandbox-alice-42",
    "apiKey": "sk_test_…(64 chars, shown ONCE)",
    "permissions": { "projects":["sandbox-alice-42"], "operations":["read","write"], "transports":["rest","mcp"] },
    "expiresAt": "2026-05-02T18:38:19.920Z",
    "quota": { "reqPerDay": 500 },
    "exampleCurl": "curl https://octonet.amia.fr/api/v1/sandbox-alice-42/User -H \"X-API-Key: sk_test_…\"",
    "mcpUrl": "https://octonet.amia.fr/mcp"
  }
}
```

Your sandbox is :
- A private **SQLite file** (isolated from other aliases)
- Pre-seeded with `User`, `Product`, `Order` entities
- Read+write CRUD via REST and MCP
- 500 requests/day quota
- TTL 7 days (auto-deleted if idle)
- Free, no email required, anti-abuse rate-limited (10 sandboxes/h/IP)

Use the apikey in any of the [14 NetClients](#14-polyglot-netclients) :

```bash
# Java / .NET / Python / Go / etc.
export MOSTAJS_NET_URL=https://octonet.amia.fr
export MOSTAJS_NET_API_KEY=sk_test_…
```

---

## 3-tier onboarding model

| Tier | Cible | Auth | Quota | Use case |
|---|---|---|---|---|
| **T1 — Sandbox publique** [`/try`](https://octonet.amia.fr/try) | "I want to test in 10 minutes" | alias seul (pas d'email) | 500 req/jour, TTL 7j | démo NetClients, intégration tests |
| **T2 — Compte enregistré** [octocloud.amia.fr](https://octocloud.amia.fr) | "j'utilise vraiment, gratuit" | email + mot de passe | 10 000 req/jour | apps personnelles, side-projects |
| **T3 — Self-host** `npx @mostajs/net init` | "tes données chez toi" | admin local | aucune | enterprise, on-premise, AGPL |

---

## 11 transports

Auto-generated from your registered schemas. Toggle each via env var (default : all enabled).

| # | Transport | Endpoint | Use case | Notes |
|---|---|---|---|---|
| 1 | **REST** | `/api/v1/{Entity}` · `/api/v1/{project}/{Entity}` | universel | 15 routes par entité (CRUD + count + search + aggregate + bulk + relations) |
| 2 | **GraphQL** | `/graphql` (POST) | front-end riches | schéma + GraphiQL IDE auto-générés via mercurius |
| 3 | **WebSocket** | `wss://…/ws` | temps réel | events `entity.created/updated/deleted/upserted` broadcast |
| 4 | **SSE** | `/events` (GET stream) | mobile / browser-friendly | server-sent events |
| 5 | **JSON-RPC** | `/rpc` (POST) | EVM-adjacent, classic | JSON-RPC 2.0 + method discovery |
| 6 | **MCP** | `/mcp` (POST/GET SSE) | agents IA (Claude, ChatGPT) | 15 tools/entité auto-générés ([listed on mcp.so](https://mcp.so/server/octonet-mcp/apolocine)) |
| 7 | **gRPC** | `:50051` | inter-services low-latency | `.proto` auto-généré, 6 RPCs/entité |
| 8 | **tRPC** | `/trpc/{Entity}.{op}` | TypeScript fullstack | type generation côté client |
| 9 | **OData** | `/odata/{Collection}` (+ `$metadata`) | SAP/Microsoft Dynamics | OData v4 ($filter, $select, $orderby) |
| 10 | **NATS** | `mostajs.{Entity}.{op}` | pub/sub edge | request-reply messaging |
| 11 | **Arrow Flight** | `/arrow/*` | analytics columnaire | streaming zero-copy |

**Le même schéma**, 11 portes d'entrée différentes, 0 codegen.

---

## 13 databases

Persistence dialects fournis par `@mostajs/orm` :

| Catégorie | Bases | Dialect ID |
|---|---|---|
| SQL mainstream | PostgreSQL, MySQL, MariaDB, SQLite | `postgres`, `mysql`, `mariadb`, `sqlite` |
| SQL enterprise | Oracle, SQL Server, DB2, SAP HANA, HSQLDB, Sybase | `oracle`, `mssql`, `db2`, `hana`, `hsqldb`, `sybase` |
| NewSQL / Cloud | CockroachDB, Google Cloud Spanner | `cockroachdb`, `spanner` |
| NoSQL | MongoDB | `mongodb` |

Switch dialect = changer 1 ligne d'env :

```bash
DB_DIALECT=postgres → DB_DIALECT=mongodb
SGBD_URI=postgresql://… → SGBD_URI=mongodb://…
```

---

## Multi-tenant authentication

Octonet utilise un middleware d'authentification basé sur **API keys avec scopes** (orienté machine-to-machine) + RBAC pour la gestion humaine. L'orchestrateur agnostique vit dans `@mostajs/auth/lib/check-request.ts`.

### Flux d'auth d'une requête

```
HTTP Request
  │
  ▼
authGuard (Fastify adapter)
  │
  ▼
checkRequest (@mostajs/auth — framework-agnostic)
  │
  ├─ extract X-API-Key from header / Bearer token / ?apikey=
  ├─ resolveApiKey (@mostajs/api-keys) — DB lookup + bcrypt verify
  ├─ isScopeAuthorized (@mostajs/api-keys) — check scope.values
  │     for each (scope, value) pair :
  │       checks: [{scope:'projects', value:slug},
  │                {scope:'operations', value:'read'|'write'|'admin'},
  │                {scope:'transports', value:'rest'|'mcp'|...}]
  ├─ touchApiKey — fire-and-forget : lastUsedAt, usageCount, lastIp
  │
  ▼
ormHandler (entité CRUD) ─→ sanitizer (strip password/hash/tokens)
  │
  ▼
HTTP Response
```

### Scope-based permissions (generic, extensible)

Une apikey a la shape :

```ts
{
  permissions: {
    scopes: {
      projects:   ['my-project','demo'] | '*',     // declared by @mostajs/mproject
      operations: ['read','write','admin'] | '*',  // declared by @mostajs/orm
      transports: ['rest','graphql','mcp'] | '*',  // declared by @mostajs/net
      // anything: any module can register a new scope
    },
    rateLimit: 500,
  }
}
```

`@mostajs/api-keys` ne connaît PAS les noms `projects/operations/transports` — c'est volontaire. Chaque module enregistre ses scopes au boot via `registerScope(dialect, {name, label, …})`. Le check est générique : `isScopeAuthorized(perms, scope, value)`.

### HTTP status mapping

| Cas | HTTP code | Body |
|---|---|---|
| Pas d'apikey | 401 | `{error: {code:'UNAUTHORIZED', message:'API key required…'}}` |
| Apikey invalide / révoquée | 401 | `{error: {code:'UNAUTHORIZED', message:'Invalid or revoked API key'}}` |
| Apikey valide hors scope | 403 | `{error: {code:'FORBIDDEN', message:'API key not authorized for X="Y"'}}` |
| Apikey OK | 200/201 | `{status:'ok', data: …}` (sanitized — no password/hash) |

### MCP fallback (compat mcp.so)

L'endpoint `/mcp` autorise un **fallback automatique** sur l'apikey labelée `public-default` quand aucune clé n'est présentée — préserve la compat avec mcp.so / Claude Desktop. La clé publique est **read-only sur le projet `default`** uniquement → écritures bloquées.

### Sanitizer

Les champs `password`, `hash`, `verifyToken`, `resetToken`, `apiKeyHash`, `secret`, `privateKey` sont **automatiquement strippés** de toutes les réponses JSON par un middleware global. Aucun risque de leak à travers `/api/v1/User?limit=1`.

---

## Generic scope registry

Le catalogue des scopes vit en **base de données du projet accueillant** (pas de fichier JSON, pas de constantes hardcodées) :

```sql
-- Auto-créées au boot via @mostajs/api-keys
CREATE TABLE api_key_scopes (
  id, name, label, description, icon, cardinality,
  valuesSource ('static' | 'dynamic'), dynamicSourceRef
);

CREATE TABLE api_key_scope_values (
  id, scopeName, value, label, sortOrder, metadata
);
```

Chaque module enregistre ses scopes au boot :

```ts
import { registerScope } from '@mostajs/api-keys/server'

// Dans mosta-net/src/server.ts (boot)
await registerScope(dialect, {
  name: 'transports', label: 'Network transports',
  cardinality: 'low', valuesSource: 'static',
  staticValues: [
    {value:'rest', sortOrder:1},
    {value:'graphql', sortOrder:2},
    // … 9 more
  ],
})

await registerScope(dialect, {
  name: 'projects', label: 'Projects',
  cardinality: 'high', valuesSource: 'dynamic',
  dynamicSourceRef: 'Project.slug',  // queried at runtime
})
```

L'admin UI charge le catalogue dynamique via `GET /api/api-keys/scopes` et rend une matrice (composant React `ApiKeyScopeMatrix` dans `@mostajs/api-keys/components/`).

---

## Multi-project support

Via `@mostajs/mproject` — N bases de données isolées sur le même serveur.

### Routes path-prefix

```bash
# Default project (DB_DIALECT + SGBD_URI au boot)
curl http://localhost:4488/api/v1/User

# Project nommé 'analytics'
curl http://localhost:4488/api/v1/analytics/events

# Ou via header (équivalent)
curl http://localhost:4488/api/v1/events -H "X-Project: analytics"
```

### Ajouter un projet à l'exécution

```bash
curl -X POST http://localhost:4488/api/projects \
  -H "X-API-Key: <admin-key>" \
  -d '{
    "name": "analytics",
    "dialect": "mongodb",
    "uri": "mongodb://localhost:27017/analytics",
    "schemas": [{"name":"Event", "fields":{"type":"string","ts":"date"}}]
  }'
```

Persisté dans `projects-tree.json` (chemin : `MOSTA_PROJECTS` env var).

---

## Quick start (self-host)

### Install

```bash
npm install @mostajs/net @mostajs/orm @mostajs/mproject \
            @mostajs/rbac @mostajs/auth @mostajs/api-keys \
            @mostajs/config better-sqlite3
```

### Run with SQLite (zero infra)

```bash
DB_DIALECT=sqlite \
SGBD_URI=./data/octonet.db \
DB_SCHEMA_STRATEGY=update \
OCTONET_ADMIN_EMAIL=admin@example.com \
OCTONET_ADMIN_PASSWORD=ChangeMe123! \
npx mostajs-net serve
```

Console output :

```
Loaded 3 schemas from schemas.json
[DAL:SQLite] INIT_SCHEMA strategy=update {"entities":["User","Product","Order"]}
✓ Apikey scopes registered (projects, operations, transports)
✓ RBAC ready — admin=admin@example.com trial=…  public=…
⚠ public demo apikey emitted ONCE → sk_live_xxxxxxxx…  (save it!)
✓ Sanitizer middleware on rest, graphql, ws, sse, trpc, mcp, odata, jsonrpc
✓ ApiKey middleware on rest, graphql, ws, sse, trpc, mcp, odata, jsonrpc
✓ Protected ormHandler ready (sanitizer + apikey global wrapper)
✓ T1 sandbox endpoint /try ready (rate-limited 10/h/IP, TTL 7d)

  @mostajs/net  v2.6.x
  ─────────────────────────────────────────────────
  Dialect:    sqlite (./data/octonet.db)
  Entities:   User, Product, Order  (3)
  Port:       4488
  Strategy:   update
  Transports: rest, graphql, ws, sse, trpc, mcp, odata, jsonrpc  (8)
  Ready.  3 entities × 8 transports = 24 endpoints
```

### Test

```bash
# Sans apikey → 401
curl http://localhost:4488/api/v1/User
# {"error":{"code":"UNAUTHORIZED","message":"API key required…"}}

# Avec apikey publique (depuis les logs ↑)
curl http://localhost:4488/api/v1/User -H "X-API-Key: sk_live_…"
# {"status":"ok","data":[{"id":"…","email":"admin@example.com",…}]}  ← password absent
```

---

## Configuration (.env)

### Database (mandatory)

```bash
DB_DIALECT=postgres                                # any of 13 dialects
SGBD_URI=postgresql://user:pass@localhost:5432/db
DB_SCHEMA_STRATEGY=update                          # 'update' (recommandé prod) | 'create' (drop+recreate, dev only)
DB_SHOW_SQL=false
```

### System dialect (recommandé prod, optionnel) — v2.7.5+

Sépare la base **système** *(apikeys, RBAC users, audit, plans, payments, project-life metadata)* du dialect **métier mutable**. Sans ces variables, alias transparent vers le singleton métier *(rétro-compat mono-base)*.

```bash
MOSTA_SYSTEM_DIALECT=postgres                       # any of 13 dialects
MOSTA_SYSTEM_URI=postgresql://user:pass@localhost:5432/octonet_system
```

Voir section [System dialect](#system-dialect-séparé-du-singleton-métier) ci-dessous pour la motivation et les how-to.

### Server

```bash
MOSTA_NET_PORT=4488
MOSTA_PROJECTS=./projects-tree.json                # path to multi-project config
SCHEMAS_PATH=./schemas                              # directory scanning fallback
```

### Transports (toggle each)

```bash
MOSTA_NET_REST_ENABLED=true
MOSTA_NET_GRAPHQL_ENABLED=true
MOSTA_NET_WS_ENABLED=true
MOSTA_NET_SSE_ENABLED=true
MOSTA_NET_JSONRPC_ENABLED=true
MOSTA_NET_MCP_ENABLED=true
MOSTA_NET_TRPC_ENABLED=true
MOSTA_NET_ODATA_ENABLED=true
MOSTA_NET_GRPC_ENABLED=false
MOSTA_NET_NATS_ENABLED=false
MOSTA_NET_ARROW_ENABLED=false

MOSTA_NET_CORS_ORIGIN=*
MOSTA_RATE_LIMIT_CLIENT=1000
```

### RBAC bootstrap (lus via `@mostajs/config` — supports profile cascade `MOSTA_ENV=DEV`)

```bash
OCTONET_ADMIN_EMAIL=admin@example.com               # 1er boot only ; ignored after
OCTONET_ADMIN_PASSWORD=secret-12345
OCTONET_ADMIN_FIRSTNAME=Admin                       # optional
OCTONET_ADMIN_LASTNAME=Octonet                      # optional
OCTONET_BOOTSTRAP_VERBOSE=false                     # detailed bootstrap logs
OCTONET_OPEN_MODE=false                             # dev only — passe sans apikey
```

### T1 sandbox (optional)

```bash
OCTONET_TRIAL_DATA_DIR=./data/trials                # SQLite files per alias
```

### Cloud middleware (optional, futur — partage DB méta avec Octocloud)

```bash
OCTONET_META_URI=postgresql://user:pass@localhost:5432/octonet_meta   # shared meta DB
PORTAL_DB_URI=postgresql://user:pass@localhost:5432/octonet_cloud     # legacy octocloud DB
```

---

## API endpoints reference

### Public

| Endpoint | Méthode | Auth | Description |
|---|---|---|---|
| `/health` | GET | open | server status + transports + entities |
| `/try` | GET | open | T1 sandbox provisioning HTML form |
| `/try` | POST | open (rate-limit 10/h/IP) | crée sandbox + retourne apikey one-shot |
| `/api/v1/health` | GET | open | health under api-versioned path |

### Project / entity CRUD (requires apikey)

| Endpoint | Méthode | Op | Description |
|---|---|---|---|
| `/api/v1/{Entity}` | GET | findAll | list entities of default project |
| `/api/v1/{Entity}/:id` | GET | findById | get one |
| `/api/v1/{Entity}/count` | GET | count | count |
| `/api/v1/{Entity}/one` | GET | findOne | first match |
| `/api/v1/{Entity}/search` | GET | search | text search |
| `/api/v1/{Entity}` | POST | create | insert |
| `/api/v1/{Entity}/:id` | PUT | update | replace |
| `/api/v1/{Entity}/:id` | DELETE | delete | remove |
| `/api/v1/{Entity}/:id/addToSet` | POST | addToSet | add to array |
| `/api/v1/{Entity}/:id/pull` | POST | pull | remove from array |
| `/api/v1/{Entity}/:id/increment` | POST | increment | numeric add |
| `/api/v1/{Entity}/upsert` | POST | upsert | insert or update |
| `/api/v1/{Entity}/aggregate` | POST | aggregate | pipeline |
| `/api/v1/{Entity}/updateMany` | POST | updateMany | bulk update |
| `/api/v1/{Entity}/deleteMany` | POST | deleteMany | bulk delete |
| `/api/v1/{project}/{Entity}/…` | * | * | same routes scoped to a project |

### Schema management (requires admin apikey)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/upload-schemas-json` | POST | push schemas at runtime (triggers reload) |
| `/api/apply-schema` | POST | apply schema diff |
| `/api/compare-schema` | POST | dry-run schema diff |
| `/api/schemas-config` | GET | current registered schemas |

### Auth & API keys (requires admin)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/api-keys` | GET / POST | list / issue keys |
| `/api/api-keys/:id` | PUT / DELETE | update / revoke |
| `/api/api-keys/scopes` | GET | list registered scopes + values (for admin matrix UI) |
| `/api/api-keys/scopes` | POST | register a new scope (admin) |
| `/api/api-keys/scopes/:name/values` | PUT / DELETE | manage scope values |

### Transports natifs

| Endpoint | Description |
|---|---|
| `/graphql` | GraphQL endpoint + GraphiQL IDE |
| `/ws` | WebSocket connection (entity events) |
| `/events` | SSE stream |
| `/rpc` | JSON-RPC 2.0 |
| `/mcp` | Model Context Protocol (Claude/Smithery/etc.) |
| `/trpc/{Entity}.{op}` | tRPC procedure |
| `/odata/{Collection}` · `/odata/$metadata` | OData v4 |

### Multi-project management

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/projects` | GET | list projects |
| `/api/projects` | POST | add project |
| `/api/projects/:name` | PUT / DELETE | edit / remove |

### Observability

| Endpoint | Description |
|---|---|
| `/api/performance` | live metrics (req/s, p50, p99) |
| `/api/config-tree` | configuration tree (interactive) |
| `/api/live-log` | streaming log feed |

---

## Architecture

```
                                 ┌──────────────────────────────────┐
                                 │       Fastify (port 4488)        │
                                 └────────────────┬─────────────────┘
                                                  │
       ┌─────────────────────────────────────────┴──────────────────────────────┐
       │                                                                        │
       ▼                                                                        ▼
┌────────────────────────┐                                       ┌────────────────────────┐
│  Transports (11)       │                                       │  Direct Fastify routes │
│  - REST                │                                       │  - /try                │
│  - GraphQL (mercurius) │                                       │  - /api/projects/*     │
│  - WS                  │                                       │  - /api/api-keys/*     │
│  - SSE                 │                                       │  - /health, /metrics   │
│  - JSON-RPC            │                                       └────────────────────────┘
│  - MCP (SDK Anthropic) │
│  - gRPC                │              ┌─────────────────────────────────────┐
│  - tRPC                │              │  Auth pipeline                      │
│  - OData               │              │  ┌──────────────┐                   │
│  - NATS                │              │  │ extractAuth  │ ←  HTTP request   │
│  - Arrow               ├──────────────┤  │ Context      │                   │
└────────────────────────┘              │  └──────┬───────┘                   │
                                        │         ▼                           │
                                        │  ┌──────────────┐                   │
                                        │  │ checkRequest │ ←  scope-checks   │
                                        │  │ (mosta-auth) │                   │
                                        │  └──────┬───────┘                   │
                                        │         ▼                           │
                                        │  ┌──────────────┐                   │
                                        │  │ checkApiKey  │ ←  resolve+verify │
                                        │  │ (api-keys)   │                   │
                                        │  └──────┬───────┘                   │
                                        └─────────┼───────────────────────────┘
                                                  ▼
                                        ┌────────────────────────┐
                                        │ Sanitizer middleware   │
                                        │ strips password/hash/  │
                                        │ tokens before response │
                                        └────────┬───────────────┘
                                                 ▼
                                        ┌────────────────────────┐
                                        │ ormHandler             │
                                        │ → ProjectManager.resolve│
                                        │ → EntityService.execute │
                                        └────────┬───────────────┘
                                                 ▼
                                        ┌────────────────────────┐
                                        │ @mostajs/orm dialect   │
                                        │ (13 SGBD)              │
                                        └────────────────────────┘
```

### Modules de l'écosystème consommés

| Module | Rôle dans Octonet |
|---|---|
| `@mostajs/orm` | persistance (13 dialects) |
| `@mostajs/mproject` | gestion multi-projet (default + sandbox + abonnés) |
| `@mostajs/rbac` | identité (User, Role, Permission, Account) + AccountSchema + OCTONET_RBAC_SEED |
| `@mostajs/auth` | `checkRequest` orchestrateur framework-agnostic, hashPassword |
| `@mostajs/api-keys` | apikey CRUD + scopes (`Scope`/`ScopeValue` schemas) + `checkApiKey` + `ApiKeyScopeMatrix` admin UI |
| `@mostajs/config` | env var helper avec cascade `MOSTA_ENV` |
| `@mostajs/cloud-middleware` | quota / abonnement (optionnel — actif si Octocloud connecté) |
| `@mostajs/replicator` | CQRS multi-replica (optionnel) |
| `@mostajs/project-life` | persistence schemas Project (optionnel — si stockage SGBD vs JSON) |

---

## System dialect (séparé du singleton métier)

> **Disponible depuis v2.7.5** — résout le bug *« apikeys introuvables après `/api/change-dialect` »* observé en prod.

### Pourquoi deux dialects distincts ?

Octonet expose des routes admin qui mutent la connexion DB au runtime *(`/api/change-dialect`, `/api/reload-config`, `/api/reconnect`)* — légitime côté **métier** *(les entités userland du projet courant peuvent migrer postgres → sqlite → mongodb selon les besoins de l'admin)*.

Mais les modules **système** *(apikeys, RBAC users, audit, plans de souscription, payments, project-life metadata)* doivent vivre dans une base **stable** qui ne suit pas ces mutations. Sinon : un changement de dialect métier rend les apikeys introuvables, l'admin se trouve verrouillé hors de l'IHM.

| Rôle | Variable env | Mutable au runtime ? | Lu par |
|------|--------------|----------------------|--------|
| **Métier** *(entités userland)* | `DB_DIALECT` + `SGBD_URI` | **Oui** *(IHM admin)* | `EntityService`, transports, routes data |
| **Système** *(infra Octonet)* | `MOSTA_SYSTEM_DIALECT` + `MOSTA_SYSTEM_URI` | **Non** *(stable)* | RBAC, apikey-middleware, account-scope, auth guards, sandbox /try |

### Configuration recommandée *(prod multi-base)*

```bash
# Métier — peut bouger via /api/change-dialect
DB_DIALECT=postgres
SGBD_URI=postgresql://hmd:***@127.0.0.1:5432/octonet_business

# Système — stable, jamais touché par les routes admin
MOSTA_SYSTEM_DIALECT=postgres
MOSTA_SYSTEM_URI=postgresql://hmd:***@127.0.0.1:5432/octonet_system
```

### Configuration mono-base *(dev / déploiement simple)*

Laisser `MOSTA_SYSTEM_*` vides → alias automatique vers le singleton métier *(rétro-compat 100 %, comportement identique au pré-v2.7.5)*.

### How-to

#### 1. Migrer un déploiement existant vers le mode multi-base

```bash
# 1. Sauvegarder la base actuelle
pg_dump octonet_business > backup-pre-split.sql

# 2. Créer la base système (vide — RBAC seed re-exécute au boot)
createdb octonet_system

# 3. Ajouter MOSTA_SYSTEM_* dans .env
echo 'MOSTA_SYSTEM_DIALECT=postgres' >> .env.local
echo 'MOSTA_SYSTEM_URI=postgresql://hmd:***@127.0.0.1:5432/octonet_system' >> .env.local

# 4. Restart Octonet — le bootstrap RBAC + scopes seed sur octonet_system
pm2 restart octonet-mcp

# 5. Restaurer les apikeys et RBAC users de l'ancienne base
#    (à scripter selon convention métier — typiquement export/import des
#    tables api_keys, users, roles, permissions, scopes, scope_values)
```

#### 2. Vérifier que le système est bien isolé du métier

```bash
# Avant /api/change-dialect : apikey doit fonctionner
curl -H "X-API-Key: sk_live_…" http://localhost:4488/api/auth/verify
# → 200 OK

# Bouger le dialect métier vers SQLite
curl -X POST -H "Content-Type: application/json" \
  -d '{"dialect":"sqlite","uri":":memory:","connect":true}' \
  http://localhost:4488/api/change-dialect
# → "Dialecte changé et connecté : sqlite"

# Re-tester l'apikey — DOIT toujours fonctionner (système intact)
curl -H "X-API-Key: sk_live_…" http://localhost:4488/api/auth/verify
# → 200 OK (bug résolu en v2.7.5)
```

Avant v2.7.5, le 2ᵉ curl retournait `503 metadata DB unavailable` ou `401 PostgreSQL not connected. Call connect() first.`

#### 3. Lire le system dialect depuis du code applicatif

```ts
import { getSystemDialect } from '@mostajs/data-plug'

const sysDialect = await getSystemDialect()
// Utiliser comme un dialect normal pour requêter les tables système
// (apikeys, users, roles, audit_log, plans, etc.)
```

#### 4. Inspecter le bootstrap au démarrage

Au boot d'`octonet-mcp`, deux logs apparaissent :

```
✓ DB connectée: postgres                            ← métier
✓ System dialect: postgres (octonet_system)         ← système (si MOSTA_SYSTEM_* défini)
✓ RBAC ready — admin=… trial=… public=…             ← seed côté système
✓ ApiKey middleware on REST/SSE/GraphQL/...         ← câblé sur système
```

### Sites système dans `src/server.ts` *(pour référence)*

18 callers tirent désormais leur dialect via `getSystemDialect()` au lieu du singleton métier :

| Bloc | Sites | Caller |
|------|-------|--------|
| RBAC bootstrap | 1 | `bootstrapRbac(systemDialect, …)` |
| Scopes register | 4 | `registerScope(systemDialect, …)` × 3 + `systemDialect.initSchema(scopeTables)` |
| Middlewares globaux | 2 | `createApiKeyMiddleware(() => systemDialect, …)` + `createAccountScopeMiddleware(() => systemDialect)` |
| Middlewares per-transport | 2 | idem appliqués sur chaque `transport.use(…)` |
| Auth guards transports | 6 | `authGuard(systemDialect, …)` × 6 *(SSE, GraphQL, JSON-RPC, gRPC, tRPC, OData)* |
| Custom `/api/auth/verify` | 2 | `checkApiKey(systemDialect, …)` + `new UserRepository(systemDialect)` |
| Sandbox `/try` | 2 | `registerTryRoutes({ dialect: systemDialect, … })` + `startTrialCleanupJob({ dialect: systemDialect, … })` |

Le **dialect métier** *(`dialect`)* reste utilisé légitimement pour :
- Bootstrap initial du singleton métier *(`L98`)* + `pm.setDefault('default', dialect, …)` *(`L126`, `L240`)*
- Routes admin `/api/reconnect`, `/api/change-dialect`, `/api/reload-config`, `/api/test-connection`, `/api/truncate-tables`, `/api/drop-tables` — toutes opérations explicitement métier
- `EntityService` qui sert les entités userland *(opérations CRUD via les transports protégés)*

### Étapes du chantier *(historique)*

| Étape | Repo | Livré |
|-------|------|-------|
| 1 | `@mostajs/data-plug` v1.2.2-1.2.4 *(API `getSystemDialect` + façade ORM)* | npm |
| 2 | `@mostajs/net` v2.7.5 *(`bootstrapSystemDialect` au démarrage)* | git |
| 3 | `@mostajs/api-keys` 0.2.3, `@mostajs/payment` 0.4.1, `@mostajs/project-life` 0.1.3, `@mostajs/subscriptions-plan` 0.3.5 *(WeakMap repos + façade)* | npm |
| 4 | `@mostajs/net` v2.7.5 *(consumers basculent sur `getSystemDialect()` — 18 sites)* | git |
| 5 | Tests d'intégration scénario `/api/change-dialect` postgres → sqlite | ⏳ |
| 6 | Déploiement amia + smoke test `MOSTA_SYSTEM_URI` | ⏳ |

---

## Boot sequence

1. **Load `.env`** via `@mostajs/config` (profile cascade `MOSTA_ENV`)
2. **Connect main dialect** (`SGBD_URI`)
3. **Load schemas** (priority : `getAllSchemas()` registry → `schemas.json` → `SCHEMAS_PATH` directory scan)
4. **`dialect.initSchema(schemas)`** with strategy `update`/`create`
5. **Bootstrap RBAC** (`octonet-rbac-bootstrap.ts`) :
   - register UserSchema/RoleSchema/PermissionSchema/PermissionCategorySchema/AccountSchema/ApiKeySchema
   - `seedRBAC(OCTONET_RBAC_SEED)` — 6 categories, 25 permissions, 4 roles (admin/subscriber/trial/public)
   - `createAdmin()` from `OCTONET_ADMIN_EMAIL`/`PASSWORD`
   - create Account `trial-playground` (type='trial')
   - create User `public-demo` (role=public)
   - create Account `public-system` (type='system')
   - generate ApiKey `public-default` scoped to `default` project (read-only, REST + MCP) — emitted ONCE in clear
6. **Register canonical scopes** : `projects` (dynamic, `Project.slug`), `operations` (static : read/write/admin), `transports` (static : 11 values)
7. **Push default project to `projects-tree.json`** (ownerId=admin, visibility=public)
8. **Load additional projects** from `projects-tree.json`
9. **Wrap ormHandler** with `composeMiddleware([sanitizer, apikey], ormHandler)` → `protectedOrmHandler`
10. **Start each enabled transport** :
    - `transport.use(loggingMiddleware)`
    - `transport.use(sanitizerMiddleware)`
    - `transport.use(apiKeyMiddleware)`
    - `transport.setHandler(ormHandler)`
    - `transport.start(config)`
11. **Register Fastify routes** :
    - `registerDynamicRestRoutes(app, protectedOrmHandler, pm)` — `/api/v1/...`
    - `registerProjectRoutes(app, pm, protectedOrmHandler)` — `/:project/*`
    - `registerTryRoutes(app, {dialect, pm})` — `/try` POST
    - `registerTryPage(app)` — `/try` GET (HTML)
    - `startTrialCleanupJob({dialect, pm})` — cron horaire TTL 7j
12. **Listen on port** (`MOSTA_NET_PORT`)

---

## 14 polyglot NetClients

Octonet est consommable depuis 14 runtimes natifs, **avec la même apikey, la même URL** :

| Runtime | Package | Registre |
|---|---|---|
| Node/TS | `@mostajs/net/client` (built-in) | npm |
| Java | `com.mostajs:mostajs-net-client` | Maven Central |
| Java + Spring Boot | `com.mostajs:mostajs-net-client-spring-boot-starter` | Maven Central |
| .NET | `MostaJs.Net.Client` | NuGet |
| Python | `mostajs-net-client` | PyPI |
| Go | `github.com/apolocine/mosta-net-client-go` | pkg.go.dev |
| Swift | `mosta-net-client-swift` | Swift Package Index |
| Kotlin | `io.github.apolocine:mostajs-net-client-kt` | Maven Central |
| Dart / Flutter | `mostajs_net_client` | pub.dev |
| Rust | `mostajs-net-client` | crates.io |
| PHP | `mostajs/net-client` | Packagist |
| Ruby | `mostajs-net-client` | RubyGems |
| Elixir | `mostajs_net_client` | Hex.pm |
| Lua | `mostajs-net-client` | LuaRocks |
| Delphi | `MostaJsNetClient` | GetIt |
| Unity (C#) | `com.mostajs.net-client` | OpenUPM |

Monorepo : [github.com/apolocine/mosta-net-clients](https://github.com/apolocine/mosta-net-clients)

Chaque NetClient suit le même contrat d'API :

```
NetClient.create()
  .url(...)
  .apiKey(...)
  .build()
  .findAll(entity, filter, options)
  .findById(entity, id)
  .create(entity, data)
  .update(entity, id, data)
  .delete(entity, id)
  .uploadSchemasJson(schemas)
  .health()
```

---

## Production deploy (amia.fr)

Le déploiement de référence tourne sur `octonet.amia.fr` + `mcp.amia.fr` (alias compat) en backend PostgreSQL :

| URL | Rôle |
|---|---|
| `https://octonet.amia.fr` | Octonet server (REST, MCP, GraphQL, WS, SSE, tRPC, OData, JSON-RPC) |
| `https://mcp.amia.fr` | alias DNS de compatibilité — historique mcp.so |
| `https://octocloud.amia.fr` | Octocloud — portail SaaS Next.js (subscriptions, admin UI) |

Le kit de déploiement complet est dans `Entreprise/octonet-mcp/` :
- `apache/mcp.amia.fr.conf` — vhost Apache2 (proxy SSE, WS upgrade, certs Let's Encrypt SAN)
- `ecosystem.config.cjs` — config PM2
- `deploy.sh` / `install.sh` / `update.sh` — scripts d'orchestration
- `tests/smoke-all.sh` — suite de smoke tests (DNS, TLS, /health, SSE MCP, REST, /try, NetClient Java)

---

## CLI

```bash
npx mostajs-net serve                      # Start server
npx mostajs-net mcp                        # MCP-only mode
npx mostajs-net generate-apikey <label>    # Émettre une apikey via CLI
npx mostajs-net hash-password <password>   # Hash bcrypt
npx mostajs-net info                       # JSON config dump

npx octonet-mcp --dialect=X --uri=Y        # Standalone MCP server (process séparé)
```

---

## License

[AGPL-3.0-or-later](LICENSE) — usage libre tant que le code dérivé reste open-source.
**Licence commerciale** disponible : `drmdh@msn.com`. Pricing par projet, pas par seat.

— (c) 2026 Dr Hamid MADANI \<drmdh@msn.com\>
