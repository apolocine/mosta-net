# Changelog — @mostajs/net

## 2.7.8 (2026-06-06) — peerDependency `@mostajs/orm` élargie à `^1.13.1 || ^2.5.0`

**Changé** : la peerDependency `@mostajs/orm` passe de `^1.13.1` à **`^1.13.1 || ^2.5.0`**, et net est
désormais **buildé/testé contre `@mostajs/orm@2.5.3`** (dernière version). Cela permet aux consommateurs
d'utiliser le dernier orm — qui **corrige les anomalies #17/#18** (`indexes: [{ fields: ['a','b'] }]`,
forme tableau, générait un index sur la colonne `"0"` → `no such column: 0` → `initSchema` avorté, les
tables suivantes jamais créées). net n'utilise que des APIs orm stables (`getDialect`, `initSchema`,
`registerSchemas`, `EntityService`, `getAllSchemas`, `disconnectDialect`) → compatible 1.x **et** 2.x.

## 2.7.7 (2026-06-05) — peerDependency `@mostajs/api-keys` élargie à `^0.1.2 || ^0.2.0`

**Changé** : la peerDependency `@mostajs/api-keys` passe de `^0.1.2` à **`^0.1.2 || ^0.2.0`**.
net était déjà **dev-buildé contre `@mostajs/api-keys@^0.2.0`** (devDependency) et son code (`/try`,
apikey-middleware) est compatible 0.2.x ; seul le **peer** restait bloqué en `^0.1.x`, provoquant un
conflit `ERESOLVE` chez les consommateurs installant `@mostajs/api-keys@^0.2.x` aux côtés de net
(ex. un serveur de positions geo avec auth + api-keys). Les consommateurs en 0.1.x restent supportés.

*(Resynchronise aussi git ↔ npm : le source de 2.7.6 — bump de version, sanitizer-middleware,
octonet-rbac-bootstrap — était publié mais non commité ; il est inclus dans ce commit.)*

## 2.7.6 (2026-05-26) — Fix : sérialisation HTTP des champs `type:"date"` (Date / RegExp / Buffer / ObjectId / Map / Set)

**Bug corrigé** : tout champ d'`EntitySchema` déclaré `{ type:"date" }`, stocké en BSON Date côté MongoDB et correctement hydraté en `Date` JS par `@mostajs/orm` (`instanceof Date === true` au sortir de `EntityService.execute`), apparaissait `{}` dans la réponse HTTP REST (cas notables : `createdAt`, `updatedAt`, et tout `timestamp` métier). Les consommateurs qui filtrent par date (`v.timestamp.getTime()`, agrégation mensuelle, propagation d'IC) plantaient avec `TypeError: e.getTime is not a function`.

**Cause racine** : `src/auth/sanitizer-middleware.ts::stripFields()` reconstruisait l'objet de réponse en parcourant `Object.keys(value)` — or `Object.keys(new Date())` est `[]` (les méthodes de `Date` vivent sur le prototype, pas en propriétés énumérables propres). Conséquence : tout `Date`, et plus généralement tout objet « non-plain » (`RegExp`, `Buffer`, BSON `ObjectId`, `Map`, `Set`), était écrasé en `{}` au passage du sanitizer.

**Fix** : ajout d'un garde `isNonPlainObject(value)` dans `stripFields()`. Si vrai, on renvoie la valeur **inchangée** ; Fastify peut alors la sérialiser correctement en aval (`Date.toJSON()` → ISO 8601, `Buffer` → string base64 le cas échéant, etc.).

```ts
function isNonPlainObject(value: any): boolean {
  if (value instanceof Date) return true;
  if (value instanceof RegExp) return true;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(value)) return true;
  if (value instanceof Map || value instanceof Set) return true;
  if (value && typeof value === 'object'
      && typeof value._bsontype === 'string'
      && value._bsontype === 'ObjectId') return true;
  return false;
}
```

**Compatibilité** : aucun changement d'API publique. Les consommateurs qui faisaient `JSON.parse(JSON.stringify(resp))` côté client retrouvent automatiquement des strings ISO correctement parsables. Les routes qui rendaient `{}` à tort renvoient désormais l'ISO attendue.

**Diagnostic** : `test-scripts/diagnose-date-serialization.mjs` (générique — `--entity=` `--field=` `--port=` `--uri=`) compare la lecture d'un champ `type:"date"` via `EntityService.execute` *(chemin ORM pur)* et via `fetch` HTTP loopback du serveur — verdict immédiat sur la couche fautive. Réutilisable sur tout projet qui expose un `schemas.json` et un serveur `@mostajs/net` local.

**Origine de la régression** : un fix antérieur existait en source mais le `package.json` n'avait pas été bumpé — le binaire `dist/auth/sanitizer-middleware.js` publié sur npm pour `2.7.5` ne contenait pas la garde, alors que le source local `mostajs/mosta-net/` l'avait déjà. Comparer MD5 (`md5sum node_modules/.../dist/auth/sanitizer-middleware.js` vs source local) est désormais la procédure recommandée pour détecter ce genre d'écart « même version, binaires différents ».

---

## 2.7.5 (2026-05-04, unreleased) — Chantier « system dialect séparé du singleton métier » (étapes 2 + 4)

Cette release groupe les **étapes 2 et 4** du chantier *« system dialect séparé »* — bootstrap système au démarrage **et** bascule de tous les consumers système (RBAC, apikey-middleware, account-scope, auth guards, sandbox /try) vers `getSystemDialect()` au lieu du singleton métier mutable.

Combinée à `@mostajs/data-plug v1.2.2-1.2.4` *(façade ORM + system dialect API)* et aux refactors v0.x.y des modules consumers `api-keys` / `payment` / `project-life` / `subscriptions-plan` *(WeakMap repos + migration imports orm → data-plug)*, elle clôt le bug **« apikeys introuvables après /api/change-dialect »** observé en prod.

---

### Étape 4 — Consumers système basculent sur `getSystemDialect()`

**18 sites système** dans `src/server.ts` passent désormais `systemDialect` *(stable)* au lieu de `dialect` *(métier mutable)* :

| Bloc | Sites | Caller |
|------|-------|--------|
| RBAC bootstrap | 1 | `bootstrapRbac(systemDialect, …)` |
| Scopes register | 4 | `registerScope(systemDialect, …)` × 3 + `systemDialect.initSchema(scopeTables)` |
| Middlewares globaux | 2 | `createApiKeyMiddleware(() => systemDialect, …)` + `createAccountScopeMiddleware(() => systemDialect)` |
| Middlewares per-transport | 2 | idem appliqués sur chaque `transport.use(...)` |
| Auth guards transports | 6 | `authGuard(systemDialect, …)` × 6 *(SSE, GraphQL, JSON-RPC, gRPC, tRPC, OData)* |
| Custom `/api/auth/verify` | 2 | `checkApiKey(systemDialect, …)` + `new UserRepository(systemDialect)` |
| Sandbox `/try` | 2 | `registerTryRoutes({ dialect: systemDialect, … })` + `startTrialCleanupJob({ dialect: systemDialect, … })` |

Le **dialect métier** *(`dialect`)* reste utilisé légitimement pour :
- Bootstrap initial du singleton métier *(L98)* + `pm.setDefault('default', dialect, …)` *(L126, L240)*
- Routes admin `/api/reconnect`, `/api/change-dialect`, `/api/reload-config`, `/api/test-connection`, `/api/truncate-tables`, `/api/drop-tables` — toutes opérations explicitement métier
- `EntityService` qui sert les entités userland *(opérations CRUD via les transports protégés)*

Les guards `if (dialect)` autour des blocs RBAC + scopes ont été remplacés par `if (systemDialect)` — sémantiquement plus correct *(le bootstrap système peut réussir même si la connexion métier est down, en mode multi-base)*.

### Étape 2 — Bootstrap system dialect au démarrage (rappel)

Étape 2 originelle du chantier — câble `bootstrapSystemDialect()` dans le bootstrap d'Octonet-mcp, juste après la connexion du singleton métier et **avant** toute instanciation de middleware/handler système (apikey-middleware, rbac, audit).

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
