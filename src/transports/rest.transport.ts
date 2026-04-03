// RestTransport — REST API transport adapter
// Generates CRUD routes from EntitySchema, translates HTTP → OrmRequest → OrmResponse → HTTP
// Mirror of MongoDialect / PostgresDialect in @mostajs/orm
// Author: Dr Hamid MADANI drmdh@msn.com

import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';
import { composeMiddleware } from '../core/middleware.js';

/** Handler function that executes OrmRequest (set by the server) */
type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

export class RestTransport implements ITransport {
  readonly name = 'rest';

  private app: FastifyInstance | null = null;
  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private ormHandler: OrmHandler | null = null;
  private stats = { requests: 0, errors: 0, startedAt: 0 };

  /** Set the ORM handler (called by the server after creating EntityService) */
  setHandler(handler: OrmHandler): void {
    this.ormHandler = handler;
  }

  use(middleware: TransportMiddleware): void {
    this.middlewares.push(middleware);
  }

  registerEntity(schema: EntitySchema): void {
    this.schemas.push(schema);
  }

  async start(config: TransportConfig): Promise<void> {
    this.config = config;
    this.stats.startedAt = Date.now();

    // Fastify instance is created here but NOT listened —
    // the main server.ts will inject it into the shared Fastify instance
    this.app = Fastify({ logger: false });

    // Register routes for each entity
    for (const schema of this.schemas) {
      this.registerRoutes(schema);
    }
  }

  async stop(): Promise<void> {
    this.app = null;
  }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.app ? 'running' : 'stopped',
      url: this.config?.path || '/api/v1',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }

  /** Get the Fastify instance (for mounting in the shared server) */
  getApp(): FastifyInstance | null {
    return this.app;
  }

  // ============================================================
  // Route generation
  // ============================================================

  /** Parse common query options (sort, limit, skip, select, exclude, relations) */
  private parseQueryOptions(query: Record<string, string>): { options: any; relations?: string[] } {
    const options: any = {};
    if (query.sort) options.sort = JSON.parse(query.sort);
    if (query.limit) options.limit = parseInt(query.limit, 10);
    if (query.skip) options.skip = parseInt(query.skip, 10);
    if (query.select) options.select = query.select.split(',');
    if (query.exclude) options.exclude = query.exclude.split(',');
    const relations = (query.relations || query.include)?.split(',').filter(Boolean);
    return { options, relations: relations?.length ? relations : undefined };
  }

  private registerRoutes(schema: EntitySchema): void {
    if (!this.app) return;
    const prefix = this.config?.path || '/api/v1';
    const col = schema.collection;

    // ── Specific routes BEFORE parametric /:id ──────────

    // GET /count → count
    this.app.get(`${prefix}/${col}/count`, async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string>;
      return this.handle({ op: 'count', entity: schema.name, filter: query.filter ? JSON.parse(query.filter) : {} }, reply);
    });

    // GET /one → findOne
    this.app.get(`${prefix}/${col}/one`, async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string>;
      const { options, relations } = this.parseQueryOptions(query);
      return this.handle({ op: 'findOne', entity: schema.name, filter: query.filter ? JSON.parse(query.filter) : {}, options, relations }, reply);
    });

    // POST /search → search
    this.app.post(`${prefix}/${col}/search`, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, unknown>;
      return this.handle({ op: 'search', entity: schema.name, query: body.query as string, searchFields: body.fields as string[], options: body.options as any }, reply);
    });

    // POST /upsert → upsert
    this.app.post(`${prefix}/${col}/upsert`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { filter, data } = req.body as { filter: any; data: any };
      return this.handle({ op: 'upsert', entity: schema.name, filter, data }, reply);
    });

    // POST /aggregate → aggregate
    this.app.post(`${prefix}/${col}/aggregate`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { stages } = req.body as { stages: any[] };
      return this.handle({ op: 'aggregate', entity: schema.name, stages }, reply);
    });

    // PUT /bulk → updateMany
    this.app.put(`${prefix}/${col}/bulk`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { filter, data } = req.body as { filter: any; data: any };
      return this.handle({ op: 'updateMany', entity: schema.name, filter, data }, reply);
    });

    // DELETE /bulk → deleteMany
    this.app.delete(`${prefix}/${col}/bulk`, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, unknown> | null;
      const query = req.query as Record<string, string>;
      const filter = body?.filter || (query.filter ? JSON.parse(query.filter) : {});
      return this.handle({ op: 'deleteMany', entity: schema.name, filter }, reply);
    });

    // ── Parametric /:id routes ──────────────────────────

    // GET /:id → findById (with optional ?relations=)
    this.app.get(`${prefix}/${col}/:id`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const query = req.query as Record<string, string>;
      const { options, relations } = this.parseQueryOptions(query);
      return this.handle({ op: 'findById', entity: schema.name, id, options, relations }, reply);
    });

    // PUT /:id → update
    this.app.put(`${prefix}/${col}/:id`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      return this.handle({ op: 'update', entity: schema.name, id, data: req.body as Record<string, unknown> }, reply);
    });

    // DELETE /:id → delete
    this.app.delete(`${prefix}/${col}/:id`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      return this.handle({ op: 'delete', entity: schema.name, id }, reply);
    });

    // POST /:id/addToSet → addToSet
    this.app.post(`${prefix}/${col}/:id/addToSet`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const { field, value } = req.body as { field: string; value: unknown };
      return this.handle({ op: 'addToSet', entity: schema.name, id, field, value }, reply);
    });

    // POST /:id/pull → pull
    this.app.post(`${prefix}/${col}/:id/pull`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const { field, value } = req.body as { field: string; value: unknown };
      return this.handle({ op: 'pull', entity: schema.name, id, field, value }, reply);
    });

    // POST /:id/increment → increment
    this.app.post(`${prefix}/${col}/:id/increment`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const { field, amount } = req.body as { field: string; amount: number };
      return this.handle({ op: 'increment', entity: schema.name, id, field, amount }, reply);
    });

    // ── Collection-level routes ─────────────────────────

    // GET / → findAll (with optional ?relations=, ?select=, ?exclude=)
    this.app.get(`${prefix}/${col}`, async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string>;
      const { options, relations } = this.parseQueryOptions(query);
      return this.handle({ op: 'findAll', entity: schema.name, filter: query.filter ? JSON.parse(query.filter) : {}, options, relations }, reply);
    });

    // POST / → create
    this.app.post(`${prefix}/${col}`, async (req: FastifyRequest, reply: FastifyReply) => {
      const res = await this.handle({ op: 'create', entity: schema.name, data: req.body as Record<string, unknown> }, reply);
      if (reply.statusCode < 400) reply.status(201);
      return res;
    });
  }

  // ============================================================
  // Request handling (OrmRequest → middleware → OrmResponse → HTTP)
  // ============================================================

  private async handle(ormReq: OrmRequest, reply: FastifyReply): Promise<unknown> {
    this.stats.requests++;

    if (!this.ormHandler) {
      this.stats.errors++;
      reply.status(503);
      return { status: 'error', error: { code: 'NO_HANDLER', message: 'ORM handler not initialized' } };
    }

    const ctx: TransportContext = { transport: this.name };

    // Compose middleware chain → final handler
    const chain = composeMiddleware(this.middlewares, this.ormHandler);
    const res = await chain(ormReq, ctx);

    if (res.status === 'error') {
      this.stats.errors++;
      const code = this.mapErrorToHttpStatus(res.error?.code);
      reply.status(code);
    }

    return res;
  }

  private mapErrorToHttpStatus(code?: string): number {
    switch (code) {
      case 'ENTITY_NOT_FOUND': return 404;
      case 'EntityNotFoundError': return 404;
      case 'MISSING_ID': return 400;
      case 'MISSING_DATA': return 400;
      case 'MISSING_QUERY': return 400;
      case 'MISSING_PARAMS': return 400;
      case 'MISSING_STAGES': return 400;
      case 'UNKNOWN_OP': return 400;
      case 'ValidationError': return 422;
      case 'ConnectionError': return 503;
      default: return 500;
    }
  }
}

/** Factory function (used by transport loader) */
export function createTransport(): ITransport {
  return new RestTransport();
}
