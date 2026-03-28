// McpTransport — Model Context Protocol transport adapter
// Exposes ORM entities as MCP tools and resources for AI agents (Claude, GPT, etc.)
// Uses the official @modelcontextprotocol/sdk
// Author: Dr Hamid MADANI drmdh@msn.com

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'http';
import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

export class McpTransport implements ITransport {
  readonly name = 'mcp';

  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private ormHandler: OrmHandler | null = null;
  private stats = { requests: 0, errors: 0, startedAt: 0 };

  setHandler(handler: OrmHandler): void { this.ormHandler = handler; }
  use(mw: TransportMiddleware): void { this.middlewares.push(mw); }
  registerEntity(schema: EntitySchema): void { this.schemas.push(schema); }

  async start(config: TransportConfig): Promise<void> {
    this.config = config;
    this.stats.startedAt = Date.now();

    // MCP server is created per-request in handleRequest() (stateless mode)
  }

  async stop(): Promise<void> {
    this.config = null;
  }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.config ? 'running' : 'stopped',
      url: this.config?.path || '/mcp',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }

  getPath(): string {
    return this.config?.path || '/mcp';
  }

  /**
   * Handle an incoming MCP HTTP request.
   * Called by the main Fastify server via route handler.
   */
  /**
   * Handle an incoming MCP HTTP request.
   * Creates a new McpServer + Transport per session for stateless mode.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    // Create a fresh MCP server per request (stateless mode)
    const server = new McpServer(
      { name: '@mostajs/orm', version: '1.5.0' },
      { capabilities: { tools: {}, resources: {} } },
    );

    // Register tools and resources
    for (const schema of this.schemas) {
      this.registerEntityToolsOn(server, schema);
      this.registerEntityResourcesOn(server, schema);
    }

    // Create transport and connect
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  // ============================================================
  // Tool registration (CRUD operations per entity)
  // ============================================================

  private registerEntityToolsOn(server: McpServer, schema: EntitySchema): void {
    const name = schema.name;

    // Tool: {Entity}_findAll — query entities
    server.registerTool(
      `${name}_findAll`,
      {
        description: `Find all ${name} entities. Optionally filter, sort, limit.`,
        inputSchema: {
          filter: z.string().optional().describe('JSON filter object (MongoDB-style)'),
          sort: z.string().optional().describe('JSON sort object, e.g. {"name":1}'),
          limit: z.number().optional().describe('Max results to return'),
          skip: z.number().optional().describe('Number of results to skip'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({
          op: 'findAll',
          entity: name,
          filter: params.filter ? JSON.parse(params.filter) : {},
          options: {
            sort: params.sort ? JSON.parse(params.sort) : undefined,
            limit: params.limit,
            skip: params.skip,
          },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_findById — get one entity by ID
    server.registerTool(
      `${name}_findById`,
      {
        description: `Find a ${name} entity by its ID.`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID`),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'findById', entity: name, id: params.id });
        if (!res.data) {
          return { content: [{ type: 'text' as const, text: `${name} with id "${params.id}" not found` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_create — create a new entity
    server.registerTool(
      `${name}_create`,
      {
        description: `Create a new ${name} entity.`,
        inputSchema: {
          data: z.string().describe(`JSON object with ${name} fields: ${Object.keys(schema.fields).join(', ')}`),
        },
      },
      async (params) => {
        this.stats.requests++;
        const data = JSON.parse(params.data);
        const res = await this.callOrm({ op: 'create', entity: name, data });
        if (res.status === 'error') {
          return { content: [{ type: 'text' as const, text: `Error: ${res.error?.message}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_update — update an entity
    server.registerTool(
      `${name}_update`,
      {
        description: `Update a ${name} entity by ID.`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID to update`),
          data: z.string().describe('JSON object with fields to update'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const data = JSON.parse(params.data);
        const res = await this.callOrm({ op: 'update', entity: name, id: params.id, data });
        if (res.status === 'error') {
          return { content: [{ type: 'text' as const, text: `Error: ${res.error?.message}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_delete — delete an entity
    server.registerTool(
      `${name}_delete`,
      {
        description: `Delete a ${name} entity by ID.`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID to delete`),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'delete', entity: name, id: params.id });
        return { content: [{ type: 'text' as const, text: res.data ? 'Deleted' : 'Not found' }] };
      },
    );

    // Tool: {Entity}_count — count entities
    server.registerTool(
      `${name}_count`,
      {
        description: `Count ${name} entities. Optionally filter.`,
        inputSchema: {
          filter: z.string().optional().describe('JSON filter object'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({
          op: 'count',
          entity: name,
          filter: params.filter ? JSON.parse(params.filter) : {},
        });
        return { content: [{ type: 'text' as const, text: String(res.data) }] };
      },
    );

    // Tool: {Entity}_findOne — find one entity by filter
    server.registerTool(
      `${name}_findOne`,
      {
        description: `Find a single ${name} entity matching a filter.`,
        inputSchema: {
          filter: z.string().describe('JSON filter object'),
          relations: z.string().optional().describe('Comma-separated relation names to populate'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const relations = params.relations?.split(',').filter(Boolean);
        const res = await this.callOrm({ op: 'findOne', entity: name, filter: JSON.parse(params.filter), relations: relations?.length ? relations : undefined });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_search — full-text search
    server.registerTool(
      `${name}_search`,
      {
        description: `Search ${name} entities by text query.`,
        inputSchema: {
          query: z.string().describe('Search text'),
          fields: z.string().optional().describe('Comma-separated field names to search in'),
          limit: z.number().optional().describe('Max results'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'search', entity: name, query: params.query, searchFields: params.fields?.split(','), options: { limit: params.limit } });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_upsert — insert or update
    server.registerTool(
      `${name}_upsert`,
      {
        description: `Insert or update a ${name} entity. Finds by filter, creates if not found.`,
        inputSchema: {
          filter: z.string().describe('JSON filter to match existing entity'),
          data: z.string().describe('JSON data to insert or update'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'upsert', entity: name, filter: JSON.parse(params.filter), data: JSON.parse(params.data) });
        if (res.status === 'error') return { content: [{ type: 'text' as const, text: `Error: ${res.error?.message}` }], isError: true };
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_deleteMany — delete multiple entities
    server.registerTool(
      `${name}_deleteMany`,
      {
        description: `Delete multiple ${name} entities matching a filter.`,
        inputSchema: {
          filter: z.string().describe('JSON filter object'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'deleteMany', entity: name, filter: JSON.parse(params.filter) });
        return { content: [{ type: 'text' as const, text: `Deleted: ${res.metadata?.count ?? 0}` }] };
      },
    );

    // Tool: {Entity}_updateMany — update multiple entities
    server.registerTool(
      `${name}_updateMany`,
      {
        description: `Update multiple ${name} entities matching a filter.`,
        inputSchema: {
          filter: z.string().describe('JSON filter object'),
          data: z.string().describe('JSON data to set on matched entities'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'updateMany', entity: name, filter: JSON.parse(params.filter), data: JSON.parse(params.data) });
        return { content: [{ type: 'text' as const, text: `Updated: ${res.metadata?.count ?? 0}` }] };
      },
    );

    // Tool: {Entity}_aggregate — aggregation pipeline
    server.registerTool(
      `${name}_aggregate`,
      {
        description: `Run an aggregation pipeline on ${name} entities.`,
        inputSchema: {
          stages: z.string().describe('JSON array of aggregation stages'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'aggregate', entity: name, stages: JSON.parse(params.stages) });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_addToSet — add value to array field
    server.registerTool(
      `${name}_addToSet`,
      {
        description: `Add a value to an array field of a ${name} entity (no duplicates).`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID`),
          field: z.string().describe('Array field name'),
          value: z.string().describe('JSON value to add'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'addToSet', entity: name, id: params.id, field: params.field, value: JSON.parse(params.value) });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_pull — remove value from array field
    server.registerTool(
      `${name}_pull`,
      {
        description: `Remove a value from an array field of a ${name} entity.`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID`),
          field: z.string().describe('Array field name'),
          value: z.string().describe('JSON value to remove'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'pull', entity: name, id: params.id, field: params.field, value: JSON.parse(params.value) });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_increment — increment numeric field
    server.registerTool(
      `${name}_increment`,
      {
        description: `Increment a numeric field of a ${name} entity.`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID`),
          field: z.string().describe('Numeric field name'),
          amount: z.number().describe('Amount to increment (negative to decrement)'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'increment', entity: name, id: params.id, field: params.field, amount: params.amount });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );
  }

  // ============================================================
  // Resource registration (schema info per entity)
  // ============================================================

  private registerEntityResourcesOn(server: McpServer, schema: EntitySchema): void {

    // Resource: entity schema definition
    server.registerResource(
      `${schema.name} Schema`,
      `entity://${schema.name}/schema`,
      { description: `Schema definition for ${schema.name} entity`, mimeType: 'application/json' },
      async () => ({
        contents: [{
          uri: `entity://${schema.name}/schema`,
          text: JSON.stringify(schema, null, 2),
          mimeType: 'application/json',
        }],
      }),
    );
  }

  // ============================================================
  // ORM call helper
  // ============================================================

  private async callOrm(req: OrmRequest): Promise<OrmResponse> {
    if (!this.ormHandler) {
      return { status: 'error', error: { code: 'NO_HANDLER', message: 'ORM handler not initialized' } };
    }
    const ctx: TransportContext = { transport: this.name };
    return this.ormHandler(req, ctx);
  }
}

/** Factory */
export function createTransport(): ITransport {
  return new McpTransport();
}
