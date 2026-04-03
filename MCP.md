# OctoNet MCP — Model Context Protocol Server

> 1 MCP server, 13 databases, zero config. Auth + RBAC included.

## Quick Start

```bash
npx octonet-mcp --dialect=postgres --uri=postgresql://user:pass@localhost:5432/mydb
```

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

### Mode stdio (local, 1 database)

```json
{
  "mcpServers": {
    "octonet": {
      "command": "npx",
      "args": [
        "octonet-mcp",
        "--dialect=postgres",
        "--uri=postgresql://user:pass@localhost:5432/mydb"
      ]
    }
  }
}
```

### Mode stdio (multi-projets)

```json
{
  "mcpServers": {
    "octonet-multi": {
      "command": "npx",
      "args": [
        "octonet-mcp",
        "--dialect=postgres",
        "--uri=postgresql://user:pass@localhost:5432/default",
        "--projects=./projects-tree.json"
      ]
    }
  }
}
```

### Mode HTTP (serveur distant)

```json
{
  "mcpServers": {
    "octonet-remote": {
      "url": "http://localhost:4488/mcp",
      "headers": {
        "x-api-key": "your-api-key"
      }
    }
  }
}
```

## Supported Databases (13)

| Category | Databases |
|---|---|
| SQL Mainstream | PostgreSQL, MySQL, MariaDB, SQLite |
| SQL Enterprise | Oracle, SQL Server, DB2, SAP HANA, HSQLDB, Sybase |
| NewSQL / Cloud | CockroachDB, Google Cloud Spanner |
| NoSQL | MongoDB |

## MCP Tools (15 per entity)

For each entity, OctoNet exposes:

- `{Entity}_findAll` — query with filter, sort, limit, skip
- `{Entity}_findById` — get by ID
- `{Entity}_create` — create new
- `{Entity}_update` — update by ID
- `{Entity}_delete` — delete by ID
- `{Entity}_count` — count with filter
- `{Entity}_findOne` — find first matching
- `{Entity}_search` — full-text search
- `{Entity}_upsert` — insert or update
- `{Entity}_deleteMany` — bulk delete
- `{Entity}_updateMany` — bulk update
- `{Entity}_aggregate` — aggregation pipeline
- `{Entity}_addToSet` — add to array field
- `{Entity}_pull` — remove from array field
- `{Entity}_increment` — increment number field

## MCP Prompts

- `describe-schema` — describe all entities, fields, relations
- `suggest-query` — help build a MongoDB-style filter
- `explain-data` — explain query results in plain language
- `list-entities` — quick entity overview

## Multi-Project

With `--projects=./projects-tree.json`, tools are namespaced:
- `default_User_findAll` — query users on default project
- `analytics_Event_findAll` — query events on analytics project

```json
// projects-tree.json
{
  "analytics": {
    "dialect": "mongodb",
    "uri": "mongodb://user:pass@localhost:27017/analytics",
    "schemas": [...]
  }
}
```

## CLI Options

```
npx octonet-mcp [options]

Options:
  --dialect=<dialect>   Database type
  --uri=<uri>           Connection string
  --port=<port>         HTTP port (default: 4488)
  --projects=<file>     Multi-project config (JSON)
  --strategy=<strategy> Schema strategy: validate|update|create|create-drop
```

## Author

Dr Hamid MADANI <drmdh@msn.com>
