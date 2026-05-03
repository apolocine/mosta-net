# Changelog — @mostajs/net

## 2.7.5 (2026-05-03, unreleased) — Bootstrap system dialect au démarrage (data-plug v1.2.2+)

Étape 2 du chantier **« system dialect séparé du singleton métier »** — câble `bootstrapSystemDialect()` dans le bootstrap d'Octonet-mcp, juste après la connexion du singleton métier et **avant** toute instanciation de middleware/handler système (apikey-middleware, rbac, audit).

### Motivation

Le singleton `getDialect()` est mutable au runtime via `/api/change-dialect`, `/api/reload-config`, `/api/reconnect`. Légitime côté métier — mais les modules **système** (apikeys, RBAC users, audit, plans, payments, project-life metadata) doivent vivre dans une base **stable** qui ne suit pas ces mutations, sinon les apikeys deviennent introuvables après un changement de dialect métier *(bug confirmé en prod, cf. `test-scripts/bug-fixed/`)*.

`@mostajs/data-plug v1.2.2` introduit `getSystemDialect / bootstrapSystemDialect` ; cette release de `@mostajs/net` les câble côté serveur.

### Changements

- **`src/server.ts`** : import `bootstrapSystemDialect` ; appel dans un `try/catch` tolérant aux erreurs de config (le serveur démarre même si `MOSTA_SYSTEM_URI` est mal configuré, avec message diagnostic).
- **`src/server.ts`** : commentaire ligne 70 réécrit — le singleton métier ne prétend plus *« DOIT pointer sur la meta DB »*. Le rôle système est désormais porté par `bootstrapSystemDialect / getSystemDialect`. Les deux dialects sont documentés in-line.
- **`package.json`** : bump dépendance `@mostajs/data-plug` `^1.0.0` → `^1.2.2`.

### Comportement

- Si `MOSTA_SYSTEM_DIALECT` + `MOSTA_SYSTEM_URI` sont définis : connexion **système isolée dédiée**, hors singleton métier *(recommandé en prod)*.
- Sinon : alias transparent vers le singleton métier *(rétro-compat mono-base — comportement identique au pré-v1.2.2 pour les déploiements qui n'ont pas encore basculé)*.

### Configuration recommandée *(prod multi-base)*

```bash
# Métier (mutable via IHM admin) :
DB_DIALECT=postgres
SGBD_URI=postgresql://hmd:***@127.0.0.1:5432/octonet_business

# Système (stable, jamais touché par /api/change-dialect) :
MOSTA_SYSTEM_DIALECT=postgres
MOSTA_SYSTEM_URI=postgresql://hmd:***@127.0.0.1:5432/octonet_system
```

### Étape suivante

Refactor des modules consumers (`@mostajs/api-keys`, `@mostajs/rbac`, `@mostajs/host`, `@mostajs/payment`, `@mostajs/subscriptions-plan`, `@mostajs/project-life`) pour tirer leur dialect via `getSystemDialect()` au lieu de `getDialect()`, **et** patcher leurs caches module-level `let X | null = null` en `WeakMap<IDialect, T>` pour éviter qu'ils capturent une référence dialect périmée *(bug racine : `mosta-api-keys/src/lib/key-factory.ts:9-14`)*.

---

## 2.2.7 (2026-04-24) — `resolveEntity` accepts entity name AND collection name

### Bug fix

`GET /api/v1/User` returned a 404 `UNKNOWN_ENTITY` when the registered
schema had `name: "User"` and `collection: "users"` (very common plural
convention). Root cause : the global-registry fallback in
`server.ts:resolveEntity()` only looked up by `collection` name, even
though the project-scoped branch already accepted either form
(`s.collection === collection || s.name === collection`).

Fixed by extending the fallback to also try `getSchema(name)` when the
collection lookup misses. The two lookups are idempotent (same entity,
two aliases), so there is no risk of ambiguity.

**Reported by** the Java integration test
`LiveServerIntegrationTest.findAllReadsSomething` — after successful
`uploadSchemasJson`, `findAll("User", ...)` kept returning 404 until
this fix.

### Operational impact

Any client calling `/api/v1/<EntityName>` (PascalCase) now works,
whether the entity's DB collection is `users`, `Users`, `user`, etc.
Previously only `/api/v1/users` worked, forcing clients to know the
internal storage convention. This aligns the REST surface with the
behaviour developers already got from the JS/Java client helpers
(`client.findAll('User', ...)`).

## 2.2.6 (2026-04-24) — Bug fixes surfaced by the Java client

### Bug fixes

- **`POST /api/upload-schemas-json` no longer 500s on minimal payloads.**
  Root cause lived in `@mostajs/orm` (`AbstractSqlDialect.generateIndexes`
  + `validateSchemas`) — now fixed in `@mostajs/orm@1.13.1`. No change to
  the server source here, but users on `@mostajs/net@2.0.38` must bump
  `@mostajs/orm` to 1.13.1+.

### New method on the TypeScript client (previously missing)

- **`NetClient.uploadSchemasJson(schemas)`** — calls
  `POST /api/upload-schemas-json`. Was accidentally omitted from
  `src/client.ts` despite being the primary provisioning endpoint
  server-side. Discovered while porting the client to Java
  (`com.mostajs:mostajs-net-client@0.1.0`) — the Java port ships the
  method and the TS version is catching up.

### Operational note

The server `process.exit(0)` after a successful upload is intentional
(PM2 restart picks up the new schema-derived routes). Clients must
either wait a few seconds after an `uploadSchemasJson` call or poll
`/health` until it returns 200 again. The new Java port does this
automatically; see `NetClient.uploadSchemasJson` JavaDoc.

## 2.0.38 (2026-04-03) — Branch `multi-set`

### New Features
- **11 transports** (was 6): added gRPC, tRPC, OData, NATS, Arrow Flight
- **Multi-project support** via `@mostajs/mproject` — N isolated databases on 1 server
- **MCP (OctoNet MCP)** — 15 tools + 4 prompts per entity, `npx octonet-mcp` CLI
- **Admin IHM** — projects table, config tree, schema electronic view, performance live
- **MCP Agent Simulator** — test MCP tools from the browser
- **Performance monitoring** — req/s, P50, P99, rate limiting, per-project metrics
- **Rate limiting** — configurable per client, skip admin routes
- **Auto-persistence** — projects saved to `projects-tree.json`
- **Project CRUD API** — GET/POST/PUT/DELETE `/api/projects`

### Bug Fixes
- MCP middleware chain applied (was bypassing auth/RBAC)
- `transport.start()` failure no longer crashes the server
- Dynamic transport loading with try/catch

### Breaking Changes
- `NetServer` interface now includes `pm: ProjectManager`
- `@mostajs/mproject` is a new peer dependency

## 2.0.21 (2026-03-30) — Branch `dual_ornet`

### Features
- 6 transports: REST, GraphQL, WebSocket, SSE, JSON-RPC, MCP
- NetClient (24 methods)
- NetDialectProxy (ORM over HTTP)
- Admin IHM (change dialect, truncate, drop, restart)
- API key authentication

## Author

Dr Hamid MADANI <drmdh@msn.com>
