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

  private registerRoutes(schema: EntitySchema): void {
    if (!this.app) return;
    const prefix = this.config?.path || '/api/v1';
    const collection = schema.collection;

    // GET /api/v1/{collection} → findAll
    this.app.get(`${prefix}/${collection}`, async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string>;
      const ormReq: OrmRequest = {
        op: 'findAll',
        entity: schema.name,
        filter: query.filter ? JSON.parse(query.filter) : {},
        options: {
          sort: query.sort ? JSON.parse(query.sort) : undefined,
          limit: query.limit ? parseInt(query.limit, 10) : undefined,
          skip: query.skip ? parseInt(query.skip, 10) : undefined,
          select: query.select ? query.select.split(',') : undefined,
        },
      };
      return this.handle(ormReq, reply);
    });

    // GET /api/v1/{collection}/:id → findById
    this.app.get(`${prefix}/${collection}/:id`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const query = req.query as Record<string, string>;
      const ormReq: OrmRequest = {
        op: 'findById',
        entity: schema.name,
        id,
        relations: query.include ? query.include.split(',') : undefined,
      };
      return this.handle(ormReq, reply);
    });

    // POST /api/v1/{collection} → create
    this.app.post(`${prefix}/${collection}`, async (req: FastifyRequest, reply: FastifyReply) => {
      const ormReq: OrmRequest = {
        op: 'create',
        entity: schema.name,
        data: req.body as Record<string, unknown>,
      };
      const res = await this.handle(ormReq, reply);
      if (reply.statusCode < 400) reply.status(201);
      return res;
    });

    // PUT /api/v1/{collection}/:id → update
    this.app.put(`${prefix}/${collection}/:id`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const ormReq: OrmRequest = {
        op: 'update',
        entity: schema.name,
        id,
        data: req.body as Record<string, unknown>,
      };
      return this.handle(ormReq, reply);
    });

    // DELETE /api/v1/{collection}/:id → delete
    this.app.delete(`${prefix}/${collection}/:id`, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const ormReq: OrmRequest = {
        op: 'delete',
        entity: schema.name,
        id,
      };
      return this.handle(ormReq, reply);
    });

    // GET /api/v1/{collection}/count → count
    this.app.get(`${prefix}/${collection}/count`, async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as Record<string, string>;
      const ormReq: OrmRequest = {
        op: 'count',
        entity: schema.name,
        filter: query.filter ? JSON.parse(query.filter) : {},
      };
      return this.handle(ormReq, reply);
    });

    // POST /api/v1/{collection}/search → search
    this.app.post(`${prefix}/${collection}/search`, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, unknown>;
      const ormReq: OrmRequest = {
        op: 'search',
        entity: schema.name,
        query: body.query as string,
        searchFields: body.fields as string[],
        options: body.options as any,
      };
      return this.handle(ormReq, reply);
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
