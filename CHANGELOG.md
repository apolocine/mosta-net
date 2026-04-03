# Changelog — @mostajs/net

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
