// ArrowFlightTransport — Apache Arrow Flight transport adapter
// High-performance columnar data streaming for analytics
// Author: Dr Hamid MADANI drmdh@msn.com

import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

export class ArrowFlightTransport implements ITransport {
  readonly name = 'arrow';

  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private ormHandler: OrmHandler | null = null;
  private stats = { requests: 0, errors: 0, rowsStreamed: 0, startedAt: 0 };

  setHandler(handler: OrmHandler): void { this.ormHandler = handler; }
  use(mw: TransportMiddleware): void { this.middlewares.push(mw); }
  registerEntity(schema: EntitySchema): void { this.schemas.push(schema); }

  /**
   * Handle an Arrow Flight-style HTTP request.
   * Endpoints:
   *   GET  /arrow/flights              → list available flights (entity datasets)
   *   GET  /arrow/schema/{entity}      → get Arrow schema for entity
   *   POST /arrow/stream/{entity}      → stream entity data as JSON (Arrow-compatible)
   *   POST /arrow/query/{entity}       → query with filter, return columnar
   */
  async handleRequest(method: string, path: string, body?: any): Promise<{ status: number; data: any; contentType?: string }> {
    this.stats.requests++;

    const relativePath = path.replace(/^\/arrow\/?/, '');

    // GET /arrow/flights — list available flights
    if (relativePath === 'flights' || relativePath === '') {
      return {
        status: 200,
        data: {
          flights: this.schemas.map(s => ({
            descriptor: s.name,
            collection: s.collection,
            fields: Object.entries(s.fields || {}).map(([name, def]) => ({
              name,
              type: this.mapToArrowType((def as any).type),
              nullable: !(def as any).required,
            })),
            totalRecords: -1, // unknown until queried
          })),
        },
      };
    }

    // GET /arrow/schema/{entity} — Arrow schema
    const schemaMatch = relativePath.match(/^schema\/(\w+)$/);
    if (schemaMatch) {
      const schema = this.schemas.find(s => s.name === schemaMatch[1] || s.collection === schemaMatch[1]);
      if (!schema) return { status: 404, data: { error: `Entity "${schemaMatch[1]}" not found` } };

      return {
        status: 200,
        data: {
          entity: schema.name,
          arrowSchema: {
            fields: [
              { name: 'id', type: 'utf8', nullable: false },
              ...Object.entries(schema.fields || {}).map(([name, def]) => ({
                name,
                type: this.mapToArrowType((def as any).type),
                nullable: !(def as any).required,
              })),
            ],
          },
        },
      };
    }

    // POST /arrow/stream/{entity} — stream data
    const streamMatch = relativePath.match(/^stream\/(\w+)$/);
    if (streamMatch && method === 'POST') {
      return this.streamEntity(streamMatch[1], body || {});
    }

    // POST /arrow/query/{entity} — query with filter
    const queryMatch = relativePath.match(/^query\/(\w+)$/);
    if (queryMatch && method === 'POST') {
      return this.queryEntity(queryMatch[1], body || {});
    }

    return { status: 404, data: { error: 'Unknown Arrow Flight endpoint' } };
  }

  /**
   * Stream entity data in columnar format (JSON representation of Arrow).
   */
  private async streamEntity(entityName: string, params: any): Promise<{ status: number; data: any; contentType?: string }> {
    const schema = this.schemas.find(s => s.name === entityName || s.collection === entityName);
    if (!schema) return { status: 404, data: { error: `Entity "${entityName}" not found` } };

    if (!this.ormHandler) return { status: 503, data: { error: 'ORM not connected' } };

    const ormReq: OrmRequest = {
      op: 'findAll',
      entity: schema.name,
      filter: params.filter ? (typeof params.filter === 'string' ? JSON.parse(params.filter) : params.filter) : {},
      options: {
        limit: params.limit || params.batchSize || 10000,
        skip: params.offset || 0,
      },
    };

    const ctx: TransportContext = { transport: this.name };
    const res = await this.ormHandler(ormReq, ctx);

    if (res.status === 'error') {
      this.stats.errors++;
      return { status: 500, data: { error: res.error } };
    }

    const rows = Array.isArray(res.data) ? res.data : [];
    this.stats.rowsStreamed += rows.length;

    // Convert row-oriented to columnar format
    const columns: Record<string, any[]> = { id: [] };
    for (const field of Object.keys(schema.fields || {})) {
      columns[field] = [];
    }

    for (const row of rows) {
      columns.id.push(row.id);
      for (const field of Object.keys(schema.fields || {})) {
        columns[field].push(row[field] ?? null);
      }
    }

    return {
      status: 200,
      contentType: 'application/json',
      data: {
        entity: schema.name,
        format: 'columnar',
        rowCount: rows.length,
        schema: {
          fields: [
            { name: 'id', type: 'utf8' },
            ...Object.entries(schema.fields || {}).map(([name, def]) => ({
              name,
              type: this.mapToArrowType((def as any).type),
            })),
          ],
        },
        columns,
      },
    };
  }

  /**
   * Query entity with filter and return columnar data.
   */
  private async queryEntity(entityName: string, params: any): Promise<{ status: number; data: any }> {
    return this.streamEntity(entityName, params);
  }

  /**
   * Map ORM field types to Arrow types.
   */
  private mapToArrowType(ormType: string): string {
    const map: Record<string, string> = {
      string: 'utf8',
      text: 'utf8',
      number: 'float64',
      integer: 'int64',
      float: 'float64',
      decimal: 'decimal128',
      boolean: 'bool',
      date: 'timestamp[ms]',
      objectId: 'utf8',
      json: 'utf8', // JSON stored as string
      array: 'list<utf8>',
      binary: 'binary',
      enum: 'utf8',
    };
    return map[ormType] || 'utf8';
  }

  getPath(): string { return this.config?.path || '/arrow'; }

  async start(config: TransportConfig): Promise<void> {
    this.config = config;
    this.stats.startedAt = Date.now();
  }

  async stop(): Promise<void> { this.config = null; }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.config ? 'running' : 'stopped',
      url: this.config?.path || '/arrow',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }
}

/** Factory */
export function createTransport(): ITransport {
  return new ArrowFlightTransport();
}
