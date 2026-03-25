// @mostajs/net — Main server orchestrator
// Loads config, connects ORM, starts transports, wires everything together
// Author: Dr Hamid MADANI drmdh@msn.com

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { EntityService, getAllSchemas, getDialect } from '@mostajs/orm';
import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import { loadNetConfig, getEnabledTransports } from './core/config.js';
import { getTransport, stopAllTransports } from './core/factory.js';
import { loggingMiddleware } from './core/middleware.js';
import type { TransportContext } from './core/types.js';
import { RestTransport } from './transports/rest.transport.js';
import { SSETransport } from './transports/sse.transport.js';
import { GraphQLTransport } from './transports/graphql.transport.js';
import { WebSocketTransport } from './transports/ws.transport.js';
import { JsonRpcTransport } from './transports/jsonrpc.transport.js';
import { McpTransport } from './transports/mcp.transport.js';

export interface NetServer {
  app: FastifyInstance;
  entityService: EntityService;
  stop: () => Promise<void>;
}

/**
 * Start the @mostajs/net server.
 *
 * 1. Load config from .env.local (MOSTA_NET_*)
 * 2. Connect to ORM via @mostajs/orm (reads MOSTA_ORM_* / DB_DIALECT + SGBD_URI)
 * 3. Create EntityService
 * 4. Load and start enabled transports
 * 5. Wire transports to EntityService
 * 6. Listen on MOSTA_NET_PORT
 */
export async function startServer(): Promise<NetServer> {
  // 1. Load net config
  const config = loadNetConfig();

  // 2. Connect ORM
  const dialect = await getDialect();

  // 3. Create EntityService
  const entityService = new EntityService(dialect);

  // 4. Get schemas
  const schemas = getAllSchemas();

  // 5. Display startup banner
  const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', gray: '\x1b[90m', blue: '\x1b[34m' };
  const maskedUri = (process.env.SGBD_URI || '').replace(/:([^@]+)@/, ':***@');
  console.log(`
${C.cyan}┌─────────────────────────────────────────────────────┐${C.reset}
${C.cyan}│${C.reset}  ${C.cyan}@mostajs/net${C.reset}                                        ${C.cyan}│${C.reset}
${C.cyan}│${C.reset}  Dialect:    ${C.green}${process.env.DB_DIALECT || 'unknown'}${C.reset} ${C.dim}(${maskedUri})${C.reset}
${C.cyan}│${C.reset}  Entities:   ${C.green}${schemas.map(s => s.name).join(', ')}${C.reset} ${C.dim}(${schemas.length})${C.reset}
${C.cyan}│${C.reset}  Port:       ${C.yellow}${config.port}${C.reset}
${C.cyan}│${C.reset}  Show SQL:   ${process.env.DB_SHOW_SQL === 'true' ? C.green + 'true' : C.gray + 'false'}${C.reset}  Format: ${process.env.DB_FORMAT_SQL === 'true' ? C.green + 'true' : C.gray + 'false'}${C.reset}  Highlight: ${process.env.DB_HIGHLIGHT_SQL === 'true' ? C.green + 'true' : C.gray + 'false'}${C.reset}
${C.cyan}│${C.reset}  Pool:       ${C.yellow}${process.env.DB_POOL_SIZE || '10'}${C.reset}  Strategy: ${C.yellow}${process.env.DB_SCHEMA_STRATEGY || 'none'}${C.reset}
${C.cyan}│${C.reset}  Transports: ${C.green}${getEnabledTransports(config).join(', ')}${C.reset} ${C.dim}(${getEnabledTransports(config).length})${C.reset}
${C.cyan}└─────────────────────────────────────────────────────┘${C.reset}
`);

  // 5b. Create shared Fastify instance
  const app = Fastify({ logger: false });

  // CORS — allow cross-origin requests (ornetadmin API Explorer, Studio, etc.)
  const cors = (await import('@fastify/cors')).default;
  await app.register(cors, { origin: true });

  // 5c. Request logger — log each transaction to terminal
  app.addHook('onResponse', (req, reply, done) => {
    const ms = reply.elapsedTime?.toFixed(0) || '?';
    const status = reply.statusCode;
    const method = req.method;
    const url = req.url;

    // Detect transport from URL
    let transport = 'HTTP';
    if (url.startsWith('/api/v1/')) transport = 'REST';
    else if (url.startsWith('/graphql')) transport = 'GraphQL';
    else if (url.startsWith('/rpc')) transport = 'JSON-RPC';
    else if (url.startsWith('/ws')) transport = 'WS';
    else if (url.startsWith('/events')) transport = 'SSE';
    else if (url.startsWith('/mcp')) transport = 'MCP';

    const statusColor = status < 300 ? C.green : status < 400 ? C.yellow : C.magenta;
    console.log(`${C.dim}[NET:${C.cyan}${transport}${C.dim}]${C.reset} ${C.blue}${method}${C.reset} ${url} ${statusColor}${status}${C.reset} ${C.gray}(${ms}ms)${C.reset}`);
    done();
  });

  // 6. ORM handler (OrmRequest → EntityService → OrmResponse)
  const ormHandler = async (req: OrmRequest, _ctx: TransportContext): Promise<OrmResponse> => {
    return entityService.execute(req);
  };

  // 7. Load and start enabled transports
  const enabledNames = getEnabledTransports(config);

  for (const name of enabledNames) {
    const transportConfig = config.transports[name];
    const transport = await getTransport(name, transportConfig);

    if (!transport) continue;

    // Register all schemas
    for (const schema of schemas) {
      transport.registerEntity(schema);
    }

    // Add logging middleware
    transport.use(loggingMiddleware);

    // Wire ORM handler
    if (transport instanceof RestTransport) {
      transport.setHandler(ormHandler);
    }

    // Start the transport
    await transport.start(transportConfig);

    // Mount REST routes directly on the shared Fastify instance
    if (transport instanceof RestTransport) {
      for (const schema of schemas) {
        registerRestRoutes(app, schema, ormHandler);
      }
    }

    // Mount SSE route and wire EntityService events → broadcast
    if (transport instanceof SSETransport) {
      const sseTransport = transport;
      const ssePath = sseTransport.getPath();

      // SSE endpoint: GET /events
      app.get(ssePath, async (req, reply) => {
        // Use raw Node.js response for SSE streaming
        reply.hijack();
        sseTransport.addClient(reply.raw);
      });

      // Wire EntityService change events → SSE broadcast
      entityService.on('entity.created', (data) => sseTransport.broadcast('entity.created', data));
      entityService.on('entity.updated', (data) => sseTransport.broadcast('entity.updated', data));
      entityService.on('entity.deleted', (data) => sseTransport.broadcast('entity.deleted', data));
      entityService.on('entity.upserted', (data) => sseTransport.broadcast('entity.upserted', data));
    }

    // Mount GraphQL via mercurius
    if (transport instanceof GraphQLTransport) {
      const gqlTransport = transport;
      gqlTransport.setHandler(ormHandler);
      const schema = gqlTransport.generateSchema();
      const resolvers = gqlTransport.generateResolvers();
      const mercurius = (await import('mercurius')).default;
      await app.register(mercurius, {
        schema,
        resolvers,
        path: gqlTransport.getInfo().url || '/graphql',
        graphiql: true,  // Enable GraphiQL IDE at the same path
      });
    }

    // Mount JSON-RPC endpoint
    if (transport instanceof JsonRpcTransport) {
      const rpcTransport = transport;
      rpcTransport.setHandler(ormHandler);
      const rpcPath = rpcTransport.getPath();

      app.post(rpcPath, async (req, reply) => {
        const result = await rpcTransport.handleBody(req.body);
        return result;
      });

      // Discovery: list available methods
      app.get(rpcPath, async () => ({
        jsonrpc: '2.0',
        methods: rpcTransport.listMethods(),
      }));
    }

    // Mount MCP endpoint (Streamable HTTP)
    if (transport instanceof McpTransport) {
      const mcpTransport = transport;
      mcpTransport.setHandler(ormHandler);
      const mcpPath = mcpTransport.getPath();

      // MCP uses raw Node.js request/response for streaming
      app.all(mcpPath, async (req, reply) => {
        reply.hijack();
        await mcpTransport.handleRequest(req.raw, reply.raw, req.body);
      });
    }

    const info = transport.getInfo();
    console.log(`  \x1b[32m●\x1b[0m ${info.name.charAt(0).toUpperCase() + info.name.slice(1)}Transport${info.url ? '  ' + info.url : ''}${info.port ? '  :' + info.port : ''}`);
  }

  // 8. Health check
  app.get('/health', async () => ({ status: 'ok', transports: enabledNames, entities: schemas.map(s => s.name) }));

  // 9. Listen
  await app.listen({ port: config.port, host: '0.0.0.0' });

  // 10. Attach WebSocket to the HTTP server (must be after listen)
  for (const name of enabledNames) {
    const transport = (await import('./core/factory.js')).getActiveTransports().find(t => t.name === name);
    if (transport instanceof WebSocketTransport) {
      const wsTransport = transport;
      wsTransport.setHandler(ormHandler);
      wsTransport.attachToServer(app.server);

      // Wire change events → WS broadcast
      entityService.on('entity.created', (data) => wsTransport.broadcast('entity.created', data));
      entityService.on('entity.updated', (data) => wsTransport.broadcast('entity.updated', data));
      entityService.on('entity.deleted', (data) => wsTransport.broadcast('entity.deleted', data));
    }
  }

  console.log(`\n  \x1b[36mReady.\x1b[0m ${schemas.length} entities × ${enabledNames.length} transports = ${schemas.length * enabledNames.length} endpoints\n`);

  return {
    app,
    entityService,
    stop: async () => {
      await stopAllTransports();
      await app.close();
    },
  };
}

/**
 * Register REST routes directly on the main Fastify instance.
 * This avoids the complexity of merging two Fastify instances.
 */
function registerRestRoutes(
  app: FastifyInstance,
  schema: EntitySchema,
  ormHandler: (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>,
): void {
  const prefix = '/api/v1';
  const col = schema.collection;

  const handle = async (ormReq: OrmRequest, reply: any) => {
    const ctx: TransportContext = { transport: 'rest' };
    const res = await ormHandler(ormReq, ctx);
    if (res.status === 'error') {
      reply.status(res.error?.code === 'ENTITY_NOT_FOUND' || res.error?.code === 'EntityNotFoundError' ? 404 :
                   res.error?.code?.startsWith('MISSING') ? 400 : 500);
    }
    return res;
  };

  // GET /api/v1/{collection}
  app.get(`${prefix}/${col}`, async (req, reply) => {
    const q = req.query as Record<string, string>;
    return handle({
      op: 'findAll', entity: schema.name,
      filter: q.filter ? JSON.parse(q.filter) : {},
      options: {
        sort: q.sort ? JSON.parse(q.sort) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        skip: q.skip ? parseInt(q.skip, 10) : undefined,
      },
    }, reply);
  });

  // GET /api/v1/{collection}/count
  app.get(`${prefix}/${col}/count`, async (req, reply) => {
    const q = req.query as Record<string, string>;
    return handle({ op: 'count', entity: schema.name, filter: q.filter ? JSON.parse(q.filter) : {} }, reply);
  });

  // GET /api/v1/{collection}/:id
  app.get(`${prefix}/${col}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    return handle({
      op: 'findById', entity: schema.name, id,
      relations: q.include ? q.include.split(',') : undefined,
    }, reply);
  });

  // POST /api/v1/{collection}
  app.post(`${prefix}/${col}`, async (req, reply) => {
    const res = await handle({ op: 'create', entity: schema.name, data: req.body as Record<string, unknown> }, reply);
    if (reply.statusCode < 400) reply.status(201);
    return res;
  });

  // PUT /api/v1/{collection}/:id
  app.put(`${prefix}/${col}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    return handle({ op: 'update', entity: schema.name, id, data: req.body as Record<string, unknown> }, reply);
  });

  // DELETE /api/v1/{collection}/:id
  app.delete(`${prefix}/${col}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    return handle({ op: 'delete', entity: schema.name, id }, reply);
  });

  // POST /api/v1/{collection}/search
  app.post(`${prefix}/${col}/search`, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    return handle({
      op: 'search', entity: schema.name,
      query: body.query as string,
      searchFields: body.fields as string[],
      options: body.options as any,
    }, reply);
  });
}
