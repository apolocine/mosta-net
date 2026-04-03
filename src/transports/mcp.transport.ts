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

interface ProjectInfo {
  name: string;
  schemas: EntitySchema[];
}

export class McpTransport implements ITransport {
  readonly name = 'mcp';

  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private ormHandler: OrmHandler | null = null;
  private stats = { requests: 0, errors: 0, startedAt: 0 };
  private projectsProvider: (() => ProjectInfo[]) | null = null;

  setHandler(handler: OrmHandler): void { this.ormHandler = handler; }
  use(mw: TransportMiddleware): void { this.middlewares.push(mw); }
  registerEntity(schema: EntitySchema): void { this.schemas.push(schema); }

  /** Set a function that returns the list of projects (called at request time) */
  setProjectsProvider(fn: () => ProjectInfo[]): void { this.projectsProvider = fn; }

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
      { name: 'OctoNet MCP', version: '2.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );

    // Register tools for default project (no prefix — backward compatible)
    for (const schema of this.schemas) {
      this.registerEntityToolsOn(server, schema);
      this.registerEntityResourcesOn(server, schema);
    }

    // Register tools for additional projects (with prefix: {project}_{entity}_op)
    if (this.projectsProvider) {
      const projects = this.projectsProvider();
      for (const project of projects) {
        if (project.name === 'default') continue; // already registered above
        for (const schema of project.schemas) {
          this.registerEntityToolsOn(server, schema, project.name);
        }
      }
    }

    this.registerPrompts(server);

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

  private registerEntityToolsOn(server: McpServer, schema: EntitySchema, projectId?: string): void {
    const name = schema.name;
    const prefix = projectId ? `${projectId}_` : '';
    const toolProjectId = projectId; // Captured for closure

    // Tool: {Entity}_findAll — query entities
    server.registerTool(
      `${prefix}${name}_findAll`,
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
        const res = await this.callOrm(toolProjectId, {
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
      `${prefix}${name}_findById`,
      {
        description: `Find a ${name} entity by its ID.`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID`),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm(toolProjectId, { op: 'findById', entity: name, id: params.id });
        if (!res.data) {
          return { content: [{ type: 'text' as const, text: `${name} with id "${params.id}" not found` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_create — create a new entity
    server.registerTool(
      `${prefix}${name}_create`,
      {
        description: `Create a new ${name} entity.`,
        inputSchema: {
          data: z.string().describe(`JSON object with ${name} fields: ${Object.keys(schema.fields).join(', ')}`),
        },
      },
      async (params) => {
        this.stats.requests++;
        const data = JSON.parse(params.data);
        const res = await this.callOrm(toolProjectId, { op: 'create', entity: name, data });
        if (res.status === 'error') {
          return { content: [{ type: 'text' as const, text: `Error: ${res.error?.message}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_update — update an entity
    server.registerTool(
      `${prefix}${name}_update`,
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
        const res = await this.callOrm(toolProjectId, { op: 'update', entity: name, id: params.id, data });
        if (res.status === 'error') {
          return { content: [{ type: 'text' as const, text: `Error: ${res.error?.message}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_delete — delete an entity
    server.registerTool(
      `${prefix}${name}_delete`,
      {
        description: `Delete a ${name} entity by ID.`,
        inputSchema: {
          id: z.string().describe(`The ${name} ID to delete`),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm(toolProjectId, { op: 'delete', entity: name, id: params.id });
        return { content: [{ type: 'text' as const, text: res.data ? 'Deleted' : 'Not found' }] };
      },
    );

    // Tool: {Entity}_count — count entities
    server.registerTool(
      `${prefix}${name}_count`,
      {
        description: `Count ${name} entities. Optionally filter.`,
        inputSchema: {
          filter: z.string().optional().describe('JSON filter object'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm(toolProjectId, {
          op: 'count',
          entity: name,
          filter: params.filter ? JSON.parse(params.filter) : {},
        });
        return { content: [{ type: 'text' as const, text: String(res.data) }] };
      },
    );

    // Tool: {Entity}_findOne — find one entity by filter
    server.registerTool(
      `${prefix}${name}_findOne`,
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
        const res = await this.callOrm(toolProjectId, { op: 'findOne', entity: name, filter: JSON.parse(params.filter), relations: relations?.length ? relations : undefined });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_search — full-text search
    server.registerTool(
      `${prefix}${name}_search`,
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
        const res = await this.callOrm(toolProjectId, { op: 'search', entity: name, query: params.query, searchFields: params.fields?.split(','), options: { limit: params.limit } });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_upsert — insert or update
    server.registerTool(
      `${prefix}${name}_upsert`,
      {
        description: `Insert or update a ${name} entity. Finds by filter, creates if not found.`,
        inputSchema: {
          filter: z.string().describe('JSON filter to match existing entity'),
          data: z.string().describe('JSON data to insert or update'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm(toolProjectId, { op: 'upsert', entity: name, filter: JSON.parse(params.filter), data: JSON.parse(params.data) });
        if (res.status === 'error') return { content: [{ type: 'text' as const, text: `Error: ${res.error?.message}` }], isError: true };
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_deleteMany — delete multiple entities
    server.registerTool(
      `${prefix}${name}_deleteMany`,
      {
        description: `Delete multiple ${name} entities matching a filter.`,
        inputSchema: {
          filter: z.string().describe('JSON filter object'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm(toolProjectId, { op: 'deleteMany', entity: name, filter: JSON.parse(params.filter) });
        return { content: [{ type: 'text' as const, text: `Deleted: ${res.metadata?.count ?? 0}` }] };
      },
    );

    // Tool: {Entity}_updateMany — update multiple entities
    server.registerTool(
      `${prefix}${name}_updateMany`,
      {
        description: `Update multiple ${name} entities matching a filter.`,
        inputSchema: {
          filter: z.string().describe('JSON filter object'),
          data: z.string().describe('JSON data to set on matched entities'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm(toolProjectId, { op: 'updateMany', entity: name, filter: JSON.parse(params.filter), data: JSON.parse(params.data) });
        return { content: [{ type: 'text' as const, text: `Updated: ${res.metadata?.count ?? 0}` }] };
      },
    );

    // Tool: {Entity}_aggregate — aggregation pipeline
    server.registerTool(
      `${prefix}${name}_aggregate`,
      {
        description: `Run an aggregation pipeline on ${name} entities.`,
        inputSchema: {
          stages: z.string().describe('JSON array of aggregation stages'),
        },
      },
      async (params) => {
        this.stats.requests++;
        const res = await this.callOrm(toolProjectId, { op: 'aggregate', entity: name, stages: JSON.parse(params.stages) });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_addToSet — add value to array field
    server.registerTool(
      `${prefix}${name}_addToSet`,
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
        const res = await this.callOrm(toolProjectId, { op: 'addToSet', entity: name, id: params.id, field: params.field, value: JSON.parse(params.value) });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_pull — remove value from array field
    server.registerTool(
      `${prefix}${name}_pull`,
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
        const res = await this.callOrm(toolProjectId, { op: 'pull', entity: name, id: params.id, field: params.field, value: JSON.parse(params.value) });
        return { content: [{ type: 'text' as const, text: JSON.stringify(res.data, null, 2) }] };
      },
    );

    // Tool: {Entity}_increment — increment numeric field
    server.registerTool(
      `${prefix}${name}_increment`,
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
        const res = await this.callOrm(toolProjectId, { op: 'increment', entity: name, id: params.id, field: params.field, amount: params.amount });
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
  // Prompts
  // ============================================================

  private registerPrompts(server: McpServer): void {
    const schemas = this.schemas;

    // Prompt: describe-schema — describe all entities
    server.registerPrompt(
      'describe-schema',
      { description: 'Describe all available entities, their fields, and relations' },
      async () => {
        const lines = schemas.map(s => {
          const fields = Object.entries(s.fields || {}).map(([n, f]: [string, any]) =>
            `  - ${n}: ${f.type}${f.required ? ' (required)' : ''}${f.default !== undefined ? ` [default: ${f.default}]` : ''}`
          ).join('\n');
          const rels = Object.entries(s.relations || {}).map(([n, r]: [string, any]) =>
            `  - ${n}: ${r.type} → ${r.target}${r.through ? ` (via ${r.through})` : ''}`
          ).join('\n');
          return `## ${s.name} (collection: ${s.collection})\nFields:\n${fields || '  (none)'}${rels ? '\nRelations:\n' + rels : ''}`;
        }).join('\n\n');
        return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Here are the available entities:\n\n${lines}` } }] };
      },
    );

    // Prompt: suggest-query — help user build a query
    server.registerPrompt(
      'suggest-query',
      {
        description: 'Help build a query for a specific entity',
        argsSchema: {
          entity: z.string().describe('Entity name to query'),
          goal: z.string().describe('What you want to find (e.g., "users created today")'),
        },
      },
      async ({ entity, goal }) => {
        const schema = schemas.find(s => s.name === entity || s.collection === entity);
        const fields = schema ? Object.keys(schema.fields || {}).join(', ') : 'unknown';
        return {
          messages: [{
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Build a MongoDB-style filter for entity "${entity}" (fields: ${fields}) to: ${goal}\n\nReturn a JSON filter object that can be passed to ${entity}_findAll filter parameter.`,
            },
          }],
        };
      },
    );

    // Prompt: explain-data — explain query results
    server.registerPrompt(
      'explain-data',
      {
        description: 'Explain the data returned by a query in human-readable format',
        argsSchema: {
          entity: z.string().describe('Entity name'),
          data: z.string().describe('JSON data to explain'),
        },
      },
      async ({ entity, data }) => {
        return {
          messages: [{
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Explain the following ${entity} data in a clear, human-readable summary:\n\n${data}`,
            },
          }],
        };
      },
    );

    // Prompt: list-entities — quick overview
    server.registerPrompt(
      'list-entities',
      { description: 'List all available entities with their field count' },
      async () => {
        const list = schemas.map(s =>
          `- **${s.name}** (${s.collection}): ${Object.keys(s.fields || {}).length} fields, ${Object.keys(s.relations || {}).length} relations`
        ).join('\n');
        return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Available entities:\n\n${list}` } }] };
      },
    );
  }

  // ============================================================

  private async callOrm(projectId: string | undefined, req: OrmRequest): Promise<OrmResponse> {
    if (!this.ormHandler) {
      return { status: 'error', error: { code: 'NO_HANDLER', message: 'ORM handler not initialized' } };
    }
    const ctx: TransportContext = { transport: this.name, projectId };

    // Apply middleware chain (auth, RBAC, logging, etc.)
    if (this.middlewares.length > 0) {
      let index = 0;
      const next = async (): Promise<OrmResponse> => {
        if (index < this.middlewares.length) {
          const mw = this.middlewares[index++];
          return mw(req, ctx, next);
        }
        return this.ormHandler!(req, ctx);
      };
      return next();
    }

    return this.ormHandler(req, ctx);
  }

  // ============================================================
  // REST API for MCP Agent Simulator (browser-friendly)
  // ============================================================

  /** Get server info (name, version, capabilities) */
  getServerInfo(): { name: string; version: string; capabilities: string[] } {
    return {
      name: 'OctoNet MCP',
      version: '2.0.0',
      capabilities: ['tools', 'resources', 'prompts'],
    };
  }

  /** List all registered tools with their schemas */
  listTools(): { name: string; description: string; inputSchema: Record<string, any> }[] {
    const tools: any[] = [];
    const addTools = (schema: EntitySchema, prefix: string) => {
      const name = schema.name;
      const fields = Object.keys(schema.fields || {}).join(', ');
      const ops = ['findAll', 'findById', 'create', 'update', 'delete', 'count', 'findOne', 'search', 'upsert', 'deleteMany', 'updateMany', 'aggregate', 'addToSet', 'pull', 'increment'];
      for (const op of ops) {
        const toolName = `${prefix}${name}_${op}`;
        tools.push({ name: toolName, description: `${op} on ${name}`, entity: name, operation: op, fields });
      }
    };
    for (const s of this.schemas) addTools(s, '');
    if (this.projectsProvider) {
      for (const p of this.projectsProvider()) {
        if (p.name === 'default') continue;
        for (const s of p.schemas) addTools(s, p.name + '_');
      }
    }
    return tools;
  }

  /** List all registered prompts */
  listPrompts(): { name: string; description: string; args?: string[] }[] {
    return [
      { name: 'describe-schema', description: 'Describe all entities, fields, relations' },
      { name: 'suggest-query', description: 'Help build a query', args: ['entity', 'goal'] },
      { name: 'explain-data', description: 'Explain query results', args: ['entity', 'data'] },
      { name: 'list-entities', description: 'Quick entity overview' },
    ];
  }

  /** Execute a tool call via the ORM handler (REST proxy for browser) */
  async executeTool(toolName: string, params: Record<string, any>): Promise<any> {
    // Parse tool name: [project_]entity_operation
    const parts = toolName.split('_');
    let projectId: string | undefined;
    let entity: string;
    let op: string;

    if (parts.length >= 3) {
      // Check if first part is a project
      const projects = this.projectsProvider ? this.projectsProvider() : [];
      if (projects.some(p => p.name === parts[0])) {
        projectId = parts[0];
        entity = parts[1];
        op = parts.slice(2).join('_');
      } else {
        entity = parts[0];
        op = parts.slice(1).join('_');
      }
    } else {
      entity = parts[0];
      op = parts[1] || 'findAll';
    }

    // Build OrmRequest
    const req: OrmRequest = { op: op as any, entity };
    if (params.id) req.id = params.id;
    if (params.filter) req.filter = typeof params.filter === 'string' ? JSON.parse(params.filter) : params.filter;
    if (params.data) req.data = typeof params.data === 'string' ? JSON.parse(params.data) : params.data;
    if (params.sort) req.options = { ...req.options, sort: typeof params.sort === 'string' ? JSON.parse(params.sort) : params.sort };
    if (params.limit) req.options = { ...req.options, limit: Number(params.limit) };
    if (params.skip) req.options = { ...req.options, skip: Number(params.skip) };
    if (params.query) (req as any).query = params.query;
    if (params.field) (req as any).field = params.field;
    if (params.value) (req as any).value = typeof params.value === 'string' ? JSON.parse(params.value) : params.value;
    if (params.amount) (req as any).amount = Number(params.amount);
    if (params.stages) req.stages = typeof params.stages === 'string' ? JSON.parse(params.stages) : params.stages;

    this.stats.requests++;
    const res = await this.callOrm(projectId, req);
    return res;
  }
}

/** Factory */
export function createTransport(): ITransport {
  return new McpTransport();
}
