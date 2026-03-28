// JsonRpcTransport — JSON-RPC 2.0 over HTTP
// Implements the JSON-RPC 2.0 specification (jsonrpc.org)
// Foundation for MCP transport (MCP uses JSON-RPC 2.0)
// Author: Dr Hamid MADANI drmdh@msn.com

import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

// ============================================================
// JSON-RPC 2.0 Types
// ============================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;       // e.g. "entity.findAll", "entity.create"
  params?: Record<string, unknown>;
  id?: string | number; // null for notifications
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: string | number | null;
}

// JSON-RPC 2.0 error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export class JsonRpcTransport implements ITransport {
  readonly name = 'jsonrpc';

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
  }

  async stop(): Promise<void> { this.config = null; }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.config ? 'running' : 'stopped',
      url: this.config?.path || '/rpc',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }

  getPath(): string {
    return this.config?.path || '/rpc';
  }

  /**
   * Handle a JSON-RPC 2.0 request body.
   * Supports single requests and batch (array of requests).
   */
  async handleBody(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    // Batch request
    if (Array.isArray(body)) {
      return Promise.all(body.map(req => this.handleSingleRequest(req)));
    }
    return this.handleSingleRequest(body as JsonRpcRequest);
  }

  private async handleSingleRequest(raw: unknown): Promise<JsonRpcResponse> {
    this.stats.requests++;

    // Validate JSON-RPC envelope
    const req = raw as JsonRpcRequest;
    if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      this.stats.errors++;
      return { jsonrpc: '2.0', error: { code: INVALID_REQUEST, message: 'Invalid JSON-RPC 2.0 request' }, id: req?.id ?? null };
    }

    // Parse method: "entity.{op}" or "{entityName}.{op}"
    const parts = req.method.split('.');
    if (parts.length < 2) {
      this.stats.errors++;
      return { jsonrpc: '2.0', error: { code: METHOD_NOT_FOUND, message: `Invalid method format: "${req.method}". Expected: "Entity.operation"` }, id: req.id ?? null };
    }

    const entityName = parts[0];
    const op = parts[1];
    const params = (req.params || {}) as Record<string, unknown>;

    // Build OrmRequest (pass-through all known fields)
    const ormReq: OrmRequest = {
      op: op as OrmRequest['op'],
      entity: entityName,
      id: params.id as string | undefined,
      filter: params.filter as any,
      data: params.data as any,
      options: params.options as any,
      relations: params.relations as string[] | undefined,
      query: params.query as string | undefined,
      searchFields: params.searchFields as string[] | undefined,
      stages: params.stages as any,
      field: params.field as string | undefined,
      value: params.value,
      amount: params.amount as number | undefined,
    };

    if (!this.ormHandler) {
      this.stats.errors++;
      return { jsonrpc: '2.0', error: { code: INTERNAL_ERROR, message: 'ORM handler not initialized' }, id: req.id ?? null };
    }

    const ctx: TransportContext = { transport: this.name };
    const res = await this.ormHandler(ormReq, ctx);

    if (res.status === 'error') {
      this.stats.errors++;
      return {
        jsonrpc: '2.0',
        error: { code: INTERNAL_ERROR, message: res.error?.message || 'Unknown error', data: res.error },
        id: req.id ?? null,
      };
    }

    return {
      jsonrpc: '2.0',
      result: { data: res.data, metadata: res.metadata },
      id: req.id ?? null,
    };
  }

  /**
   * List available methods (for discovery).
   */
  listMethods(): string[] {
    const methods: string[] = [];
    const ops = [
      'findAll', 'findOne', 'findById', 'create', 'update', 'delete',
      'deleteMany', 'count', 'search', 'aggregate', 'upsert',
      'updateMany', 'addToSet', 'pull', 'increment',
    ];
    for (const schema of this.schemas) {
      for (const op of ops) {
        methods.push(`${schema.name}.${op}`);
      }
    }
    return methods;
  }
}

/** Factory */
export function createTransport(): ITransport {
  return new JsonRpcTransport();
}
