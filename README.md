# MostaNet

> **Multi-protocol transport layer for @mostajs/orm** — expose your entities via 11+ protocols.
> REST, GraphQL, WebSocket, SSE, JSON-RPC, MCP, and more.

[![npm version](https://img.shields.io/npm/v/@mostajs/net.svg)](https://www.npmjs.com/package/@mostajs/net)
[![license](https://img.shields.io/npm/l/@mostajs/net.svg)](LICENSE)

---

## What is MostaNet?

MostaNet mirrors the **IDialect adapter pattern** of @mostajs/orm for the transport layer. Where ORM dialects abstract *where* data is stored (13 databases), transport adapters abstract *how* data is exposed (11+ protocols).

```
Client request → ITransport → OrmRequest → EntityService → IDialect → Database
                                                ↓
                              OrmResponse → ITransport → Client response
```

One `EntitySchema`, 13 databases, 11+ protocols = **143+ combinations**.

---

## Features

- **6 transports implemented** — REST, GraphQL, WebSocket, SSE, JSON-RPC, MCP
- **5 planned** — gRPC, tRPC, OData, NATS, Arrow Flight
- **API Key management** — generate, revoke, validate with 3D permission matrix (key x SGBD x protocol)
- **Middleware pipeline** — logging, auth, rate-limiting, CORS
- **CLI** — `npx @mostajs/net serve` to start the server
- **Fastify-based** — high-performance HTTP server
- **MCP transport** — AI agents (Claude, GPT) can query any database via MCP protocol

---

## Quick Start

```bash
npm install @mostajs/orm @mostajs/net
```

### 1. Define schemas

```typescript
// schemas/user.ts
import type { EntitySchema } from '@mostajs/orm'

export const UserSchema: EntitySchema = {
  name: 'User',
  collection: 'users',
  fields: {
    name:  { type: 'string', required: true },
    email: { type: 'string', required: true, unique: true },
    role:  { type: 'string', default: 'user' },
  },
  relations: {},
  indexes: [{ fields: { email: 'asc' }, unique: true }],
  timestamps: true,
}
```

### 2. Configure .env.local

```bash
# Database
DB_DIALECT=postgres
SGBD_URI=postgresql://user:pass@localhost:5432/mydb
DB_SCHEMA_STRATEGY=update

# Transports
MOSTA_NET_REST_ENABLED=true
MOSTA_NET_REST_PORT=3000
MOSTA_NET_GRAPHQL_ENABLED=true
MOSTA_NET_WS_ENABLED=true
MOSTA_NET_SSE_ENABLED=true
MOSTA_NET_JSONRPC_ENABLED=true
MOSTA_NET_MCP_ENABLED=true

# Logging (from @mostajs/orm)
DB_SHOW_SQL=true
DB_FORMAT_SQL=true
DB_HIGHLIGHT_SQL=true
DB_POOL_SIZE=20
```

### 3. Start the server

```bash
npx @mostajs/net serve
```

Or programmatically :

```typescript
import { startServer } from '@mostajs/net'

await startServer({
  schemas: [UserSchema],
  port: 3000,
})
```

### 4. Use it

```bash
# REST
curl http://localhost:3000/api/v1/users
curl -X POST http://localhost:3000/api/v1/users -d '{"name":"Dr Madani","email":"drmdh@msn.com"}'

# GraphQL
curl -X POST http://localhost:3000/graphql -d '{"query":"{ users { id name email } }"}'

# JSON-RPC
curl -X POST http://localhost:3000/rpc -d '{"jsonrpc":"2.0","method":"User.findAll","id":1}'

# WebSocket
wscat -c ws://localhost:3000/ws
> {"op":"findAll","entity":"User"}

# MCP (via Claude/GPT agent)
# Tools: User_findAll, User_create, User_count, etc.
```

---

## Transports

| Transport | Protocol | Status | Use case |
|-----------|----------|--------|----------|
| **RestTransport** | HTTP REST | ✅ Production | Universal API (7 routes per entity) |
| **GraphQLTransport** | GraphQL | ✅ Production | Flexible queries, auto-generated schema |
| **WebSocketTransport** | WebSocket | ✅ Production | Bidirectional, real-time |
| **SSETransport** | Server-Sent Events | ✅ Production | Real-time broadcast (entity.created/updated/deleted) |
| **JsonRpcTransport** | JSON-RPC 2.0 | ✅ Production | Batch requests, method discovery |
| **McpTransport** | Model Context Protocol | ✅ Production | AI agents (Claude, GPT, Copilot) |
| GrpcTransport | gRPC | Planned | Service-to-service |
| TrpcTransport | tRPC | Planned | End-to-end type safety |
| ODataTransport | OData | Planned | Enterprise integration |
| NatsTransport | NATS | Planned | Message queue |
| ArrowFlightTransport | Arrow Flight | Planned | Analytics, big data |

---

## API Key Management

```bash
# Generate a key
npx @mostajs/net generate-apikey "My App" live

# List keys
npx @mostajs/net list-keys

# Revoke a key
npx @mostajs/net revoke-key "My App"
```

Keys are stored in `.mosta/apikeys.json` with bcrypt hashes and a 3D permission matrix (API key x database x transport x operation).

---

## Architecture

```
@mostajs/net (this package)
    ↓ depends on
@mostajs/orm (13 databases)
    ↓ managed by
@mostajs/ornetadmin (admin UI)
```

- **net depends on orm** (unidirectional)
- **orm has zero transport dependencies**
- **ornetadmin writes config files** that orm and net read

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx @mostajs/net serve` | Start the transport server |
| `npx @mostajs/net info` | Show config, transports, API keys |
| `npx @mostajs/net generate-apikey <name> [live\|test]` | Generate an API key |
| `npx @mostajs/net list-keys` | List all API keys |
| `npx @mostajs/net revoke-key <name>` | Revoke an API key |
| `npx @mostajs/net hash-password <password>` | Hash a password (SHA-256) |

---

## License

MIT — © 2025-2026 Dr Hamid MADANI <drmdh@msn.com>

## Contributing

Issues and PRs welcome at [github.com/apolocine/mosta-net](https://github.com/apolocine/mosta-net).
