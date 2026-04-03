// ODataTransport — OData v4 transport adapter
// Supports $filter, $select, $orderby, $top, $skip, $count, $expand
// Author: Dr Hamid MADANI drmdh@msn.com

import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

export class ODataTransport implements ITransport {
  readonly name = 'odata';

  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private ormHandler: OrmHandler | null = null;
  private stats = { requests: 0, errors: 0, startedAt: 0 };

  setHandler(handler: OrmHandler): void { this.ormHandler = handler; }
  use(mw: TransportMiddleware): void { this.middlewares.push(mw); }
  registerEntity(schema: EntitySchema): void { this.schemas.push(schema); }

  /**
   * Handle OData HTTP request.
   * URL patterns:
   *   GET /odata/Users              → findAll
   *   GET /odata/Users('id')        → findById
   *   GET /odata/Users/$count       → count
   *   POST /odata/Users             → create
   *   PATCH /odata/Users('id')      → update
   *   DELETE /odata/Users('id')     → delete
   *
   * Query options: $filter, $select, $orderby, $top, $skip, $count, $expand
   */
  async handleRequest(method: string, path: string, query: Record<string, string>, body?: any): Promise<{ status: number; data: any }> {
    this.stats.requests++;

    const prefix = this.getPath();
    const relativePath = path.replace(prefix, '').replace(/^\//, '');

    // Parse entity and ID from path
    // /Users → entity=Users, id=undefined
    // /Users('abc-123') → entity=Users, id=abc-123
    // /Users/$count → entity=Users, op=count
    const match = relativePath.match(/^(\w+)(?:\('([^']+)'\))?(?:\/\$(\w+))?/);
    if (!match) {
      return { status: 400, data: { error: { code: 'BAD_REQUEST', message: 'Invalid OData path' } } };
    }

    const [, collection, id, special] = match;
    const schema = this.schemas.find(s => s.collection === collection || s.name === collection);
    if (!schema) {
      return { status: 404, data: { error: { code: 'NOT_FOUND', message: `Entity set "${collection}" not found` } } };
    }

    const entity = schema.name;
    let op: string;

    if (special === 'count') {
      op = 'count';
    } else if (method === 'GET' && id) {
      op = 'findById';
    } else if (method === 'GET') {
      op = 'findAll';
    } else if (method === 'POST') {
      op = 'create';
    } else if (method === 'PATCH' || method === 'PUT') {
      op = 'update';
    } else if (method === 'DELETE') {
      op = 'delete';
    } else {
      return { status: 405, data: { error: { code: 'METHOD_NOT_ALLOWED', message: `${method} not supported` } } };
    }

    const ormReq: OrmRequest = { op: op as any, entity };
    if (id) ormReq.id = id;
    if (body) ormReq.data = body;

    // Parse OData query options
    const options: any = {};
    if (query.$filter) ormReq.filter = this.parseODataFilter(query.$filter);
    if (query.$orderby) options.sort = this.parseODataOrderBy(query.$orderby);
    if (query.$top) options.limit = parseInt(query.$top, 10);
    if (query.$skip) options.skip = parseInt(query.$skip, 10);
    if (query.$select) options.select = query.$select.split(',').map(s => s.trim());
    if (Object.keys(options).length > 0) ormReq.options = options;
    if (query.$expand) ormReq.relations = query.$expand.split(',').map(s => s.trim());

    try {
      const ctx: TransportContext = { transport: this.name };

      let res: OrmResponse;
      if (this.middlewares.length > 0 && this.ormHandler) {
        let index = 0;
        const handler = this.ormHandler;
        const mws = this.middlewares;
        const next = async (): Promise<OrmResponse> => {
          if (index < mws.length) return mws[index++](ormReq, ctx, next);
          return handler(ormReq, ctx);
        };
        res = await next();
      } else if (this.ormHandler) {
        res = await this.ormHandler(ormReq, ctx);
      } else {
        return { status: 503, data: { error: { code: 'SERVICE_UNAVAILABLE', message: 'ORM not connected' } } };
      }

      if (res.status === 'error') {
        this.stats.errors++;
        return { status: 500, data: { error: res.error } };
      }

      // Format OData response
      if (op === 'count') {
        return { status: 200, data: res.data };
      }
      if (op === 'findAll') {
        const items = Array.isArray(res.data) ? res.data : [];
        return {
          status: 200,
          data: {
            '@odata.context': `${prefix}/$metadata#${collection}`,
            '@odata.count': query.$count === 'true' ? res.metadata?.count || items.length : undefined,
            value: items,
          },
        };
      }
      if (op === 'create') {
        return { status: 201, data: res.data };
      }
      if (op === 'delete') {
        return { status: 204, data: null };
      }
      return { status: 200, data: res.data };
    } catch (err) {
      this.stats.errors++;
      return { status: 500, data: { error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } } };
    }
  }

  /**
   * Parse OData $filter to MongoDB-style filter.
   * Supports: eq, ne, gt, ge, lt, le, and, or, contains
   */
  private parseODataFilter(filter: string): Record<string, any> {
    const result: Record<string, any> = {};

    // Simple cases: field eq 'value'
    const eqMatch = filter.matchAll(/(\w+)\s+eq\s+'([^']+)'/g);
    for (const m of eqMatch) result[m[1]] = m[2];

    const eqNumMatch = filter.matchAll(/(\w+)\s+eq\s+(\d+(?:\.\d+)?)/g);
    for (const m of eqNumMatch) result[m[1]] = Number(m[2]);

    const neMatch = filter.matchAll(/(\w+)\s+ne\s+'([^']+)'/g);
    for (const m of neMatch) result[m[1]] = { $ne: m[2] };

    const gtMatch = filter.matchAll(/(\w+)\s+gt\s+(\d+(?:\.\d+)?)/g);
    for (const m of gtMatch) result[m[1]] = { $gt: Number(m[2]) };

    const geMatch = filter.matchAll(/(\w+)\s+ge\s+(\d+(?:\.\d+)?)/g);
    for (const m of geMatch) result[m[1]] = { $gte: Number(m[2]) };

    const ltMatch = filter.matchAll(/(\w+)\s+lt\s+(\d+(?:\.\d+)?)/g);
    for (const m of ltMatch) result[m[1]] = { $lt: Number(m[2]) };

    const leMatch = filter.matchAll(/(\w+)\s+le\s+(\d+(?:\.\d+)?)/g);
    for (const m of leMatch) result[m[1]] = { $lte: Number(m[2]) };

    // contains(field,'value')
    const containsMatch = filter.matchAll(/contains\((\w+),'([^']+)'\)/g);
    for (const m of containsMatch) result[m[1]] = { $regex: m[2], $options: 'i' };

    return result;
  }

  /**
   * Parse OData $orderby to sort object.
   * Example: "name asc,age desc" → { name: 1, age: -1 }
   */
  private parseODataOrderBy(orderby: string): Record<string, number> {
    const sort: Record<string, number> = {};
    for (const part of orderby.split(',')) {
      const [field, dir] = part.trim().split(/\s+/);
      sort[field] = dir?.toLowerCase() === 'desc' ? -1 : 1;
    }
    return sort;
  }

  /**
   * Generate OData $metadata XML (EDMX).
   */
  generateMetadata(): string {
    let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += '<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">\n';
    xml += '  <edmx:DataServices>\n';
    xml += '    <Schema Namespace="MostaJS" xmlns="http://docs.oasis-open.org/odata/ns/edm">\n';

    for (const schema of this.schemas) {
      xml += `      <EntityType Name="${schema.name}">\n`;
      xml += '        <Key><PropertyRef Name="id"/></Key>\n';
      xml += '        <Property Name="id" Type="Edm.String" Nullable="false"/>\n';
      for (const [field, def] of Object.entries(schema.fields || {})) {
        const edmType = (def as any).type === 'number' ? 'Edm.Double'
          : (def as any).type === 'boolean' ? 'Edm.Boolean'
          : (def as any).type === 'date' ? 'Edm.DateTimeOffset'
          : (def as any).type === 'integer' ? 'Edm.Int64'
          : 'Edm.String';
        xml += `        <Property Name="${field}" Type="${edmType}"/>\n`;
      }
      xml += '      </EntityType>\n';
    }

    xml += '      <EntityContainer Name="Default">\n';
    for (const schema of this.schemas) {
      xml += `        <EntitySet Name="${schema.collection}" EntityType="MostaJS.${schema.name}"/>\n`;
    }
    xml += '      </EntityContainer>\n';
    xml += '    </Schema>\n';
    xml += '  </edmx:DataServices>\n';
    xml += '</edmx:Edmx>';
    return xml;
  }

  getPath(): string { return this.config?.path || '/odata'; }

  async start(config: TransportConfig): Promise<void> {
    this.config = config;
    this.stats.startedAt = Date.now();
  }

  async stop(): Promise<void> { this.config = null; }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.config ? 'running' : 'stopped',
      url: this.config?.path || '/odata',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }
}

/** Factory */
export function createTransport(): ITransport {
  return new ODataTransport();
}
