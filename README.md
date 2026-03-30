# @mostajs/net

> Multi-protocol transport layer for @mostajs/orm — 6 transports, admin IHM, NetClient.
> Author: Dr Hamid MADANI drmdh@msn.com

## Transports

REST | GraphQL | WebSocket | SSE | JSON-RPC | MCP (Model Context Protocol)

## Install

```bash
npm install @mostajs/net @mostajs/orm
```

## How to Use

### 1. Start Server

```bash
DB_DIALECT=postgres SGBD_URI=postgresql://user:pass@localhost:5432/db npx @mostajs/net serve
```

Or without DB (configure via IHM at http://localhost:4488/):
```bash
MOSTA_NET_PORT=4488 npx @mostajs/net serve
```

### 2. NetClient (import from `@mostajs/net/client`)

```typescript
import { NetClient } from '@mostajs/net/client'

const client = new NetClient({ url: 'http://localhost:4488' })

await client.findAll('users', { status: 'active' }, { limit: 10 })
await client.findOne('users', { email: 'a@b.com' })
await client.create('users', { email: 'a@b.com', name: 'Admin' })
await client.update('users', id, { name: 'Updated' })
await client.upsert('settings', { key: 'theme' }, { key: 'theme', value: 'dark' })
await client.delete('users', id)
await client.count('users', { status: 'active' })
await client.findByIdWithRelations('users', id, ['roles'])
// Schema management
await client.compareSchema(UserSchema)
await client.applySchema([UserSchema])
await client.testDbConnection()
await client.getSchemasConfig()
```

### 3. NetDialectProxy (for dual ORM/NET mode)

```typescript
import { NetClient, createNetDialectProxy } from '@mostajs/net/client'
import { UserRepository } from '@mostajs/rbac/server'

const client = new NetClient({ url: 'http://localhost:4488' })
const dialect = createNetDialectProxy(client)

// Repositories work unchanged — dialect proxy translates to HTTP
const repo = new UserRepository(dialect)
await repo.findByEmail('admin@test.com') // → GET /api/v1/users/one?filter=...
```

### 4. IHM Admin (http://localhost:4488/)

- Change dialect (dropdown + URI per SGBD)
- Test connection (shows tables + schemas)
- Apply/unload schemas, truncate/drop tables
- API Explorer (REST, GraphQL, JSON-RPC)
- Restart server

### 5. Environment

```bash
MOSTA_NET_PORT=4488
MOSTA_NET_REST_ENABLED=true
MOSTA_NET_GRAPHQL_ENABLED=true
MOSTA_NET_WS_ENABLED=true
MOSTA_NET_SSE_ENABLED=true
MOSTA_NET_JSONRPC_ENABLED=true
MOSTA_NET_MCP_ENABLED=true
DB_DIALECT=postgres
SGBD_URI=postgresql://user:pass@localhost:5432/db
```
