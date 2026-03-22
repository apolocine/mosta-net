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
