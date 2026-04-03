// NatsTransport — NATS messaging transport adapter
// Pub/sub + request-reply pattern for event-driven architectures
// Subjects: mostajs.{entity}.{operation}
// Author: Dr Hamid MADANI drmdh@msn.com

import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

export class NatsTransport implements ITransport {
  readonly name = 'nats';

  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private ormHandler: OrmHandler | null = null;
  private natsConnection: any = null;
  private subscriptions: any[] = [];
  private stats = { requests: 0, errors: 0, published: 0, startedAt: 0 };

  setHandler(handler: OrmHandler): void { this.ormHandler = handler; }
  use(mw: TransportMiddleware): void { this.middlewares.push(mw); }
  registerEntity(schema: EntitySchema): void { this.schemas.push(schema); }

  /**
   * Start NATS transport.
   * Connects to NATS server and subscribes to request-reply subjects.
   * Subject pattern: mostajs.{entity}.{operation}
   */
  async start(config: TransportConfig): Promise<void> {
    this.config = config;
    this.stats.startedAt = Date.now();

    const natsUrl = config.options?.url as string || process.env.NATS_URL || 'nats://localhost:4222';

    try {
      const nats = await import('nats');
      this.natsConnection = await nats.connect({ servers: natsUrl });

      // Subscribe to request-reply for each entity × operation
      const ops = ['findAll', 'findById', 'create', 'update', 'delete', 'count', 'findOne', 'search', 'upsert', 'deleteMany', 'updateMany'];

      for (const schema of this.schemas) {
        for (const op of ops) {
          const subject = `mostajs.${schema.name}.${op}`;
          const sub = this.natsConnection.subscribe(subject);
          this.subscriptions.push(sub);

          // Process messages asynchronously
          (async () => {
            for await (const msg of sub) {
              await this.handleMessage(schema.name, op, msg, nats);
            }
          })();
        }
      }

      // Wildcard subscription for discovery
      const discoverySub = this.natsConnection.subscribe('mostajs.discover');
      this.subscriptions.push(discoverySub);
      (async () => {
        const sc = (await import('nats')).StringCodec();
        for await (const msg of discoverySub) {
          const entities = this.schemas.map(s => ({
            name: s.name,
            collection: s.collection,
            fields: Object.keys(s.fields || {}),
            operations: ops,
          }));
          msg.respond(sc.encode(JSON.stringify({ entities, subjects: this.listSubjects() })));
        }
      })();

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Cannot find module') || msg.includes('MODULE_NOT_FOUND')) {
        console.warn('[NATS] Module "nats" not installed. Install: npm install nats');
      } else {
        console.warn(`[NATS] Connection failed: ${msg}`);
      }
      console.warn('[NATS] Transport continues in HTTP-only mode (/api/nats/*)');
      // Transport stays alive — HTTP proxy endpoints work without NATS connection
    }
  }

  private async handleMessage(entity: string, op: string, msg: any, nats: any): Promise<void> {
    this.stats.requests++;
    const sc = nats.StringCodec();

    try {
      const payload = msg.data?.length > 0 ? JSON.parse(sc.decode(msg.data)) : {};

      const ormReq: OrmRequest = { op: op as any, entity };
      if (payload.id) ormReq.id = payload.id;
      if (payload.filter) ormReq.filter = typeof payload.filter === 'string' ? JSON.parse(payload.filter) : payload.filter;
      if (payload.data) ormReq.data = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
      if (payload.sort || payload.limit || payload.skip) {
        ormReq.options = {};
        if (payload.sort) ormReq.options.sort = typeof payload.sort === 'string' ? JSON.parse(payload.sort) : payload.sort;
        if (payload.limit) ormReq.options.limit = Number(payload.limit);
        if (payload.skip) ormReq.options.skip = Number(payload.skip);
      }
      if (payload.query) (ormReq as any).query = payload.query;
      if (payload.field) (ormReq as any).field = payload.field;
      if (payload.value) (ormReq as any).value = payload.value;
      if (payload.amount) (ormReq as any).amount = Number(payload.amount);

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
        msg.respond(sc.encode(JSON.stringify({ status: 'error', error: { code: 'NO_HANDLER' } })));
        return;
      }

      // Reply
      if (msg.reply) {
        msg.respond(sc.encode(JSON.stringify(res)));
      }

      // Also publish event for pub/sub subscribers
      if (['create', 'update', 'delete'].includes(op)) {
        const eventSubject = `mostajs.events.${entity}.${op}d`;
        this.natsConnection?.publish(eventSubject, sc.encode(JSON.stringify({ entity, op, data: res.data })));
        this.stats.published++;
      }

    } catch (err) {
      this.stats.errors++;
      const sc2 = nats.StringCodec();
      if (msg.reply) {
        msg.respond(sc2.encode(JSON.stringify({ status: 'error', error: { message: err instanceof Error ? err.message : String(err) } })));
      }
    }
  }

  /**
   * Publish an event to NATS (for use by EntityService change events).
   */
  async publish(subject: string, data: any): Promise<void> {
    if (!this.natsConnection) return;
    try {
      const nats = await import('nats');
      const sc = nats.StringCodec();
      this.natsConnection.publish(subject, sc.encode(JSON.stringify(data)));
      this.stats.published++;
    } catch {}
  }

  /**
   * List all NATS subjects this transport subscribes to.
   */
  listSubjects(): string[] {
    const ops = ['findAll', 'findById', 'create', 'update', 'delete', 'count', 'findOne', 'search', 'upsert', 'deleteMany', 'updateMany'];
    const subjects: string[] = ['mostajs.discover'];
    for (const schema of this.schemas) {
      for (const op of ops) {
        subjects.push(`mostajs.${schema.name}.${op}`);
      }
      subjects.push(`mostajs.events.${schema.name}.created`);
      subjects.push(`mostajs.events.${schema.name}.updated`);
      subjects.push(`mostajs.events.${schema.name}.deleted`);
    }
    return subjects;
  }

  /**
   * Handle HTTP request for NATS info/proxy (when NATS server isn't available).
   */
  async handleHttpProxy(op: string, entity: string, body: any): Promise<OrmResponse> {
    if (!this.ormHandler) {
      return { status: 'error', error: { code: 'NO_HANDLER', message: 'Not connected' } };
    }

    this.stats.requests++;
    const ormReq: OrmRequest = { op: op as any, entity };
    if (body?.id) ormReq.id = body.id;
    if (body?.filter) ormReq.filter = typeof body.filter === 'string' ? JSON.parse(body.filter) : body.filter;
    if (body?.data) ormReq.data = typeof body.data === 'string' ? JSON.parse(body.data) : body.data;
    if (body?.limit) ormReq.options = { ...ormReq.options, limit: Number(body.limit) };

    const ctx: TransportContext = { transport: this.name };
    return this.ormHandler(ormReq, ctx);
  }

  async stop(): Promise<void> {
    for (const sub of this.subscriptions) {
      sub.unsubscribe?.();
    }
    this.subscriptions = [];
    if (this.natsConnection) {
      await this.natsConnection.drain();
      this.natsConnection = null;
    }
    this.config = null;
  }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.config ? 'running' : 'stopped',
      url: this.config?.options?.url as string || 'nats://localhost:4222',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }

  isConnected(): boolean { return !!this.natsConnection; }
  getSubjects(): string[] { return this.listSubjects(); }
}

/** Factory */
export function createTransport(): ITransport {
  return new NatsTransport();
}
