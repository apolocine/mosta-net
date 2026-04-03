# @mostajs/net — OctoNet

> **11 transports × 13 databases × zero config.**
> Multi-protocol transport server for @mostajs/orm with MCP (Model Context Protocol) support.

<p align="center">
  <img src="logo/octonet-icon.svg" width="128" alt="OctoNet Logo"/>
</p>

[![npm](https://img.shields.io/npm/v/@mostajs/net.svg)](https://www.npmjs.com/package/@mostajs/net)

## Install

```bash
npm install @mostajs/net @mostajs/orm @mostajs/mproject
```

## Quick Start

```bash
# Start with SQLite (zero config)
DB_DIALECT=sqlite SGBD_URI=:memory: MOSTA_NET_REST_ENABLED=true npx mostajs-net serve

# Start as MCP server (for Claude Desktop)
npx octonet-mcp --dialect=postgres --uri=postgresql://user:pass@localhost:5432/mydb
```

## 11 Transports

| # | Transport | Endpoint | Protocol |
|---|---|---|---|
| 1 | **REST** | `/api/v1/{collection}` | HTTP CRUD (15 routes per entity) |
| 2 | **GraphQL** | `/graphql` | Auto-generated schema + GraphiQL IDE |
| 3 | **WebSocket** | `/ws` | Bidirectional, real-time change events |
| 4 | **SSE** | `/events` | Server-Sent Events streaming |
| 5 | **JSON-RPC** | `/rpc` | JSON-RPC 2.0 with method discovery |
| 6 | **MCP** | `/mcp` | Model Context Protocol (AI agents: Claude, GPT) |
| 7 | **gRPC** | `:50051` | Auto-generated .proto, 6 RPCs per entity |
| 8 | **tRPC** | `/trpc/{Entity}.{op}` | TypeScript fullstack with type generation |
| 9 | **OData** | `/odata/{Collection}` | OData v4 ($filter, $select, $orderby, $metadata) |
| 10 | **NATS** | `mostajs.{Entity}.{op}` | Pub/sub + request-reply messaging |
| 11 | **Arrow Flight** | `/arrow/*` | High-performance columnar data streaming |

## 13 Databases (via @mostajs/orm)

| Category | Databases |
|---|---|
| SQL Mainstream | PostgreSQL, MySQL, MariaDB, SQLite |
| SQL Enterprise | Oracle, SQL Server, DB2, SAP HANA, HSQLDB, Sybase |
| NewSQL / Cloud | CockroachDB, Google Cloud Spanner |
| NoSQL | MongoDB |

## Multi-Project Support

Via `@mostajs/mproject` — run multiple isolated databases on the same server:

```bash
# Add project dynamically
curl -X POST http://localhost:4488/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"analytics","dialect":"mongodb","uri":"mongodb://localhost:27017/analytics","schemas":[...]}'

# CRUD on project via path prefix
curl http://localhost:4488/api/v1/analytics/events

# Or via header
curl http://localhost:4488/api/v1/events -H "X-Project: analytics"
```

## MCP (Model Context Protocol)

OctoNet exposes **15 MCP tools per entity** + **4 prompts** for AI agents.

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "octonet": {
      "command": "npx",
      "args": ["octonet-mcp", "--dialect=postgres", "--uri=postgresql://user:pass@localhost:5432/mydb"]
    }
  }
}
```

See [MCP.md](MCP.md) for full MCP documentation.

## Admin IHM

Built-in web dashboard at `http://localhost:4488/`:

- **Projects** — multi-database management with add/edit/delete
- **Configuration** — interactive decision tree from .env
- **Schema** — electronic view of DB connections + transports
- **Performance** — live metrics (req/s, P50, P99, rate limiting)
- **MCP Agent Simulator** — test MCP tools like an AI agent
- **API Explorer** — REST, GraphQL, JSON-RPC testing

## Configuration (.env)

```bash
DB_DIALECT=postgres
SGBD_URI=postgresql://user:pass@localhost:5432/mydb
DB_SCHEMA_STRATEGY=update
MOSTA_NET_PORT=4488

# Enable transports
MOSTA_NET_REST_ENABLED=true
MOSTA_NET_GRAPHQL_ENABLED=true
MOSTA_NET_WS_ENABLED=true
MOSTA_NET_SSE_ENABLED=true
MOSTA_NET_JSONRPC_ENABLED=true
MOSTA_NET_MCP_ENABLED=true
MOSTA_NET_GRPC_ENABLED=true
MOSTA_NET_TRPC_ENABLED=true
MOSTA_NET_ODATA_ENABLED=true
MOSTA_NET_NATS_ENABLED=true
MOSTA_NET_ARROW_ENABLED=true

# Rate limiting
MOSTA_RATE_LIMIT_CLIENT=1000
```

## CLI

```bash
npx mostajs-net serve          # Start server
npx mostajs-net mcp            # MCP-only mode
npx mostajs-net generate-apikey <name>
npx mostajs-net hash-password <password>
npx mostajs-net info           # JSON config dump

npx octonet-mcp --dialect=X --uri=Y   # Standalone MCP server
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Server status + transports + entities |
| `GET /api/projects` | List projects |
| `POST /api/projects` | Add project |
| `PUT /api/projects/:name` | Update project |
| `DELETE /api/projects/:name` | Remove project |
| `GET /api/performance` | Live metrics |
| `GET /api/config-tree` | Configuration tree |
| `GET /api/mcp-agent/tools` | List MCP tools |
| `POST /api/mcp-agent/call` | Execute MCP tool |
| `GET /api/grpc/proto` | Generated .proto file |
| `GET /odata/$metadata` | OData EDMX schema |

## Packages

| Package | Role |
|---|---|
| `@mostajs/orm` | ORM — 13 database dialects |
| `@mostajs/net` | Transport server — 11 protocols |
| `@mostajs/mproject` | Multi-project manager |
| `octonet-mcp` | Standalone MCP server CLI |

## License

MIT — (c) 2026 Dr Hamid MADANI <drmdh@msn.com>
