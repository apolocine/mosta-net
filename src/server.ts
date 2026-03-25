// @mostajs/net — Main server orchestrator
// Loads config, connects ORM, starts transports, wires everything together
// Author: Dr Hamid MADANI drmdh@msn.com

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { EntityService, getAllSchemas, getDialect, registerSchemas } from '@mostajs/orm';
import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import { loadSchemasFromJson, scanSchemaDirs, generateSchemasJson, getSchemasConfig, parseSchemasFromZip } from './lib/schema-loader.js';
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

  // 2. Connect ORM (non-blocking — server starts even if DB is unavailable)
  let dialect: import('@mostajs/orm').IDialect | null = null;
  let entityService: EntityService | null = null;
  let dbError = '';

  try {
    dialect = await getDialect();
    entityService = new EntityService(dialect);
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : String(e);
    // Simplify common errors
    if (dbError.includes('ECONNREFUSED')) dbError = 'Connexion refusee — le serveur DB est-il demarre ?';
    else if (dbError.includes('authentication failed') || dbError.includes('AuthenticationFailed')) dbError = 'Authentification echouee — verifiez user/password dans SGBD_URI';
    else if (dbError.includes('does not exist')) dbError = 'Base de donnees inexistante — utilisez "Creer la base" depuis l\'IHM';
    else if (dbError.includes('not found')) dbError = 'Driver DB non installe — npm install <driver>';
    console.log(`\n  \x1b[33m⚠ DB non connectee:\x1b[0m ${dbError}`);
    console.log(`  Le serveur demarre quand meme — configurez la DB depuis l'IHM\n`);
  }

  // 4. Get schemas: schemas.json → SCHEMAS_PATH → getAllSchemas() (embedded mode)
  let schemas = getAllSchemas();
  if (schemas.length === 0) {
    // Try schemas.json
    const fromJson = loadSchemasFromJson('schemas.json');
    if (fromJson.length > 0) {
      registerSchemas(fromJson);
      schemas = fromJson;
      console.log(`  Loaded ${schemas.length} schemas from schemas.json`);
    }
  }
  if (schemas.length === 0 && process.env.SCHEMAS_PATH) {
    // Try scanning directories from SCHEMAS_PATH
    const fromDirs = scanSchemaDirs(process.env.SCHEMAS_PATH);
    if (fromDirs.length > 0) {
      registerSchemas(fromDirs);
      schemas = fromDirs;
      // Auto-generate schemas.json for next time
      generateSchemasJson(fromDirs);
      console.log(`  Scanned ${schemas.length} schemas from ${process.env.SCHEMAS_PATH} → saved schemas.json`);
    }
  }

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
    if (!entityService) {
      return { status: 'error', data: null, error: { code: 'DB_NOT_CONNECTED', message: 'Base de donnees non connectee: ' + (dbError || 'configurez DB_DIALECT + SGBD_URI') } };
    }
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
      if (entityService) {
        entityService.on('entity.created', (data) => sseTransport.broadcast('entity.created', data));
        entityService.on('entity.updated', (data) => sseTransport.broadcast('entity.updated', data));
        entityService.on('entity.deleted', (data) => sseTransport.broadcast('entity.deleted', data));
        entityService.on('entity.upserted', (data) => sseTransport.broadcast('entity.upserted', data));
      }
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

  // 8b. Live log SSE — stream request logs to browser
  const liveLogClients: import('http').ServerResponse[] = [];

  app.get('/api/live-log', async (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    raw.write('data: {"type":"connected"}\n\n');
    liveLogClients.push(raw);
    raw.on('close', () => {
      const i = liveLogClients.indexOf(raw);
      if (i >= 0) liveLogClients.splice(i, 1);
    });
  });

  // Enhance request logger to also push to live-log SSE clients
  app.addHook('onResponse', (req, reply, done) => {
    if (liveLogClients.length > 0 && !req.url.startsWith('/api/live-log')) {
      const ms = reply.elapsedTime?.toFixed(0) || '?';
      let transport = 'HTTP';
      if (req.url.startsWith('/api/v1/')) transport = 'REST';
      else if (req.url.startsWith('/graphql')) transport = 'GraphQL';
      else if (req.url.startsWith('/rpc')) transport = 'JSON-RPC';
      else if (req.url.startsWith('/ws')) transport = 'WS';
      else if (req.url.startsWith('/events')) transport = 'SSE';
      else if (req.url.startsWith('/mcp')) transport = 'MCP';

      const entry = JSON.stringify({
        type: 'request',
        time: new Date().toISOString(),
        transport,
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        ms,
      });
      for (const client of liveLogClients) {
        try { client.write(`data: ${entry}\n\n`); } catch {}
      }
    }
    done();
  });

  // 8c. Import ZIP config (uploaded from ornetadmin or browser)
  app.post('/api/import-config', async (req, reply) => {
    try {
      const body = req.body as { env?: Record<string, string>; apikeys?: unknown };
      if (!body || !body.env) {
        return reply.status(400).send({ error: 'Invalid config: expected { env: {...}, apikeys: {...} }' });
      }
      // Write .env.local
      const fs = await import('fs');
      const path = await import('path');
      const envPath = path.resolve(process.cwd(), '.env.local');
      let envContent = '# Imported by @mostajs/net\n# Date: ' + new Date().toISOString() + '\n\n';
      for (const [k, v] of Object.entries(body.env)) {
        envContent += `${k}=${v}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf-8');

      // Write .mosta/apikeys.json
      if (body.apikeys) {
        const mostaDir = path.resolve(process.cwd(), '.mosta');
        if (!fs.existsSync(mostaDir)) fs.mkdirSync(mostaDir, { recursive: true });
        fs.writeFileSync(path.join(mostaDir, 'apikeys.json'), JSON.stringify(body.apikeys, null, 2), 'utf-8');
      }

      return { ok: true, message: 'Config imported. Restart the server to apply.' };
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Import failed' });
    }
  });

  // 8d. Schemas management API
  app.get('/api/schemas-config', async () => getSchemasConfig());

  app.post('/api/scan-schemas', async (req) => {
    const body = req.body as { path?: string };
    const scanPath = body?.path || process.env.SCHEMAS_PATH || '';
    if (!scanPath) return { error: 'No path provided. Set SCHEMAS_PATH in .env.local or provide path in body.' };
    const found = scanSchemaDirs(scanPath);
    return { ok: true, count: found.length, schemas: found.map(s => ({ name: s.name, collection: s.collection, fieldsCount: Object.keys(s.fields).length })) };
  });

  app.post('/api/generate-schemas', async (req) => {
    const body = req.body as { path?: string };
    const scanPath = body?.path || process.env.SCHEMAS_PATH || '';
    if (!scanPath) return { error: 'No path provided.' };
    const found = scanSchemaDirs(scanPath);
    if (found.length === 0) return { error: 'No schemas found in ' + scanPath };
    const outPath = generateSchemasJson(found);
    // Register in ORM
    registerSchemas(found);
    return { ok: true, count: found.length, path: outPath };
  });

  app.post('/api/upload-schemas', async (req) => {
    const body = req.body as { zip?: string; schemas?: EntitySchema[] };
    // Option 1: ZIP as base64
    if (body?.zip) {
      const buf = Buffer.from(body.zip, 'base64');
      const found = parseSchemasFromZip(buf);
      if (found.length === 0) return { error: 'No .schema.ts files found in ZIP' };
      generateSchemasJson(found);
      registerSchemas(found);
      return { ok: true, count: found.length, schemas: found.map(s => ({ name: s.name, collection: s.collection })) };
    }
    // Option 2: Direct schemas array
    if (body?.schemas?.length) {
      generateSchemasJson(body.schemas);
      registerSchemas(body.schemas);
      return { ok: true, count: body.schemas.length };
    }
    return { error: 'Provide zip (base64) or schemas array' };
  });

  // 8e. Database management API
  app.post('/api/test-connection', async () => {
    if (!dialect) return { ok: false, message: 'DB non connectee: ' + dbError };
    try {
      const ok = await dialect.testConnection();
      return { ok, message: ok ? 'Connexion reussie' : 'Echec de connexion' };
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : 'Erreur' };
    }
  });

  app.post('/api/reconnect', async () => {
    try {
      dialect = await getDialect();
      entityService = new EntityService(dialect);
      dbError = '';
      return { ok: true, message: 'Reconnexion reussie' };
    } catch (e: unknown) {
      dbError = e instanceof Error ? e.message : String(e);
      return { ok: false, error: dbError };
    }
  });

  app.post('/api/create-database', async (req) => {
    const body = req.body as { name?: string } | null;
    const dbDialect = process.env.DB_DIALECT || '';
    const uri = process.env.SGBD_URI || '';
    try {
      const { createDatabase } = await import('@mostajs/orm');
      const dbName = body?.name || uri.split('/').pop()?.split('?')[0] || '';
      if (!dbName) return { ok: false, error: 'Nom de base non detecte dans SGBD_URI' };
      await createDatabase(dbDialect as any, uri, dbName);
      return { ok: true, message: 'Base "' + dbName + '" creee' };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      // "already exists" is OK
      if (msg.includes('already exists') || msg.includes('existe')) return { ok: true, message: 'Base existe deja' };
      return { ok: false, error: msg };
    }
  });

  app.post('/api/apply-schema', async () => {
    if (!dialect) return { ok: false, error: 'DB non connectee. Utilisez "Reconnecter" d abord.' };
    try {
      const currentSchemas = getAllSchemas();
      if (currentSchemas.length === 0) return { ok: false, error: 'Aucun schema charge. Scannez ou uploadez les schemas d abord.' };
      await dialect.initSchema(currentSchemas);
      return { ok: true, message: currentSchemas.length + ' schemas appliques (tables creees/mises a jour)', tables: currentSchemas.map(s => s.collection) };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : 'Erreur' };
    }
  });

  // 8f. Home page — net dashboard
  app.get('/', async (req, reply) => {
    reply.type('text/html');
    return getNetDashboardHtml(config.port, enabledNames, schemas, maskedUri, dbError);
  });

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
      if (entityService) {
        entityService.on('entity.created', (data) => wsTransport.broadcast('entity.created', data));
        entityService.on('entity.updated', (data) => wsTransport.broadcast('entity.updated', data));
        entityService.on('entity.deleted', (data) => wsTransport.broadcast('entity.deleted', data));
      }
    }
  }

  console.log(`\n  \x1b[36mReady.\x1b[0m ${schemas.length} entities × ${enabledNames.length} transports = ${schemas.length * enabledNames.length} endpoints\n`);

  return {
    app,
    entityService: entityService!,
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

// ============================================================
// Net Dashboard HTML
// ============================================================

function getNetDashboardHtml(port: number, transports: string[], schemas: EntitySchema[], dbUri: string, dbErr = ''): string {
  const dialect = process.env.DB_DIALECT || 'unknown';
  const entityList = schemas.map(s => s.name);
  const restEntities = schemas.map(s => `<li><a href="/api/v1/${s.collection}" target="_blank">/api/v1/${s.collection}</a> <span style="color:#94a3b8">(${s.name})</span></li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>@mostajs/net</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0}
    .container{max-width:1000px;margin:0 auto;padding:2rem}
    h1{font-size:1.5rem;margin-bottom:.5rem;color:#38bdf8}
    h2{font-size:1.1rem;margin:1.5rem 0 .5rem;color:#94a3b8}
    .card{background:#1e293b;border-radius:8px;padding:1rem;margin:.5rem 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin:.5rem 0}
    .stat{text-align:center;padding:1rem}
    .stat .num{font-size:2rem;font-weight:bold;color:#38bdf8}
    .stat .label{color:#94a3b8;font-size:.85rem}
    a{color:#38bdf8;text-decoration:none} a:hover{text-decoration:underline}
    ul{list-style:none;padding:0} li{padding:.25rem 0;font-size:.9rem}
    .tag{display:inline-block;padding:.15rem .5rem;border-radius:4px;font-size:.75rem;margin:.1rem}
    .tag-on{background:#064e3b;color:#6ee7b7} .tag-off{background:#1e293b;color:#64748b;border:1px solid #334155}
    .mono{font-family:monospace;font-size:.8rem;color:#94a3b8}
    .btn{padding:.4rem .8rem;border:none;border-radius:4px;cursor:pointer;font-size:.85rem;background:#3b82f6;color:#fff}
    .btn:hover{opacity:.85}
    select,input,textarea{padding:.5rem;border:1px solid #334155;border-radius:4px;background:#0f172a;color:#e2e8f0;width:100%;margin:.25rem 0}
    textarea{font-family:monospace;font-size:.8rem;resize:vertical}
    pre{background:#0f172a;padding:1rem;border-radius:6px;overflow:auto;font-size:.8rem;max-height:400px;white-space:pre-wrap;color:#e2e8f0}
  </style>
</head>
<body>
<div class="container">
  <h1>@mostajs/net</h1>
  <p style="color:#94a3b8;margin-bottom:1rem">Multi-protocol transport server — <a href="/_admin/">Admin Panel</a></p>

  <div class="grid">
    <div class="card stat"><div class="num">${entityList.length}</div><div class="label">Entities</div></div>
    <div class="card stat"><div class="num">${transports.length}</div><div class="label">Transports</div></div>
    <div class="card stat"><div class="num">${entityList.length * transports.length}</div><div class="label">Endpoints</div></div>
  </div>

  <h2>Configuration</h2>
  <div class="card">
    <table style="width:100%;font-size:.9rem">
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Dialect</td><td><b>${dialect}</b> <span class="mono">${dbUri}</span></td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Port</td><td><b>${port}</b></td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Pool</td><td>${process.env.DB_POOL_SIZE || '10'}</td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Strategy</td><td>${process.env.DB_SCHEMA_STRATEGY || 'none'}</td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Show SQL</td><td>${process.env.DB_SHOW_SQL === 'true' ? '✅' : '❌'} Format: ${process.env.DB_FORMAT_SQL === 'true' ? '✅' : '❌'} Highlight: ${process.env.DB_HIGHLIGHT_SQL === 'true' ? '✅' : '❌'}</td></tr>
    </table>
    <div style="display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap;align-items:center">
      <button class="btn" onclick="doTestConn()" style="background:#3b82f6">Tester connexion</button>
      <button class="btn" onclick="doReconnect()" style="background:#8b5cf6">Reconnecter</button>
      <button class="btn" onclick="doCreateDb()" style="background:#22c55e">Créer la base</button>
      <button class="btn" onclick="doApplySchema()" style="background:#f59e0b;color:#000">Appliquer schéma</button>
      <span id="dbStatus" style="font-size:.85rem;color:#94a3b8">${dbErr ? '❌ ' + dbErr : '✅ Connecté'}</span>
    </div>
  </div>

  <h2>Transports</h2>
  <div class="card">
    ${['rest','graphql','ws','sse','jsonrpc','mcp','grpc','trpc','odata','nats','arrow'].map(t =>
      `<span class="tag ${transports.includes(t) ? 'tag-on' : 'tag-off'}">${t}</span>`
    ).join(' ')}
  </div>

  <h2>REST Endpoints</h2>
  <div class="card">
    <ul>${restEntities}</ul>
    <p style="margin-top:.5rem;font-size:.8rem;color:#64748b">Chaque entite expose : GET (list), GET/:id, GET/count, POST, PUT/:id, DELETE/:id, POST/search</p>
  </div>

  <h2>Quick Links</h2>
  <div class="card">
    <ul>
      <li><a href="/health" target="_blank">/health</a> — status du serveur</li>
      ${transports.includes('graphql') ? '<li><a href="/graphql" target="_blank">/graphql</a> — GraphiQL IDE</li>' : ''}
      ${transports.includes('sse') ? '<li><a href="/events" target="_blank">/events</a> — Server-Sent Events stream</li>' : ''}
      ${transports.includes('jsonrpc') ? '<li><a href="/rpc" target="_blank">/rpc</a> — JSON-RPC method discovery</li>' : ''}
      ${transports.includes('ws') ? '<li><span class="mono">ws://localhost:' + port + '/ws</span> — WebSocket</li>' : ''}
      <li><a href="/_admin/" target="_blank">/_admin/</a> — Admin panel (config, API keys, explorer)</li>
    </ul>
  </div>

  <h2>API Explorer</h2>
  <div class="card">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem;margin-bottom:.5rem">
      <div>
        <label style="font-size:.75rem;color:#94a3b8">Transport</label>
        <select id="exTransport">
          <option value="rest">REST</option>
          ${transports.includes('graphql') ? '<option value="graphql">GraphQL</option>' : ''}
          ${transports.includes('jsonrpc') ? '<option value="jsonrpc">JSON-RPC</option>' : ''}
        </select>
      </div>
      <div>
        <label style="font-size:.75rem;color:#94a3b8">Entite</label>
        <select id="exEntity">${entityList.map(e => `<option value="${e}">${e}</option>`).join('')}</select>
      </div>
      <div>
        <label style="font-size:.75rem;color:#94a3b8">Operation</label>
        <select id="exOp">
          <option value="findAll">findAll (GET)</option>
          <option value="findById">findById (GET /id)</option>
          <option value="count">count (GET /count)</option>
          <option value="create">create (POST)</option>
          <option value="update">update (PUT /id)</option>
          <option value="delete">delete (DELETE /id)</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem">
      <div>
        <label style="font-size:.75rem;color:#94a3b8">ID <span style="color:#64748b">(findById, update, delete)</span></label>
        <input id="exId" placeholder="uuid..."/>
      </div>
      <div>
        <label style="font-size:.75rem;color:#94a3b8">API Key <span style="color:#64748b">(optionnel)</span></label>
        <input id="exApiKey" placeholder="msk_live_..."/>
      </div>
    </div>
    <div>
      <label style="font-size:.75rem;color:#94a3b8">Body (JSON)</label>
      <textarea id="exBody" rows="3" placeholder='{"name":"Dr Madani","email":"drmdh@msn.com"}'></textarea>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.5rem;align-items:center">
      <button class="btn" onclick="doExplore()">Executer</button>
      <span id="exStatus" style="font-size:.85rem;color:#94a3b8"></span>
    </div>
    <div id="exResult" style="margin-top:.5rem;display:none">
      <pre id="exOutput"></pre>
    </div>
  </div>

  <h2>Schemas <span style="font-size:.75rem;color:#64748b;font-weight:normal">— charger les EntitySchema</span></h2>
  <div class="card">
    <div id="schemasStatus" style="margin-bottom:.5rem;font-size:.85rem;color:#94a3b8">Chargement...</div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:.5rem;margin-bottom:.5rem;align-items:end">
      <div>
        <label style="font-size:.75rem;color:#94a3b8">Chemin des schemas (SCHEMAS_PATH)</label>
        <input id="schemasPath" placeholder="./src/dal/schemas" value="${process.env.SCHEMAS_PATH || ''}"/>
      </div>
      <button class="btn" onclick="doScanSchemas()" style="height:36px">Scanner</button>
    </div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="btn" onclick="doGenerateSchemas()" style="background:#22c55e">Générer schemas.json</button>
      <button class="btn" onclick="document.getElementById('schemasZipInput').click()" style="background:#3b82f6">Uploader ZIP</button>
      <input type="file" id="schemasZipInput" accept=".zip" style="display:none" onchange="doUploadSchemasZip(this)"/>
      <span id="schemasMsg" style="font-size:.85rem;color:#94a3b8;align-self:center"></span>
    </div>
    <div id="schemasTable" style="margin-top:.5rem"></div>
  </div>

  <h2>Import Config <span style="font-size:.75rem;color:#64748b;font-weight:normal">— importer le ZIP exporté par ornetadmin</span></h2>
  <div class="card">
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
      <button class="btn" onclick="document.getElementById('zipInput').click()" style="background:#22c55e">Importer ZIP</button>
      <button class="btn" onclick="document.getElementById('jsonInput').click()">Importer JSON</button>
      <input type="file" id="zipInput" accept=".zip" style="display:none" onchange="doImportZip(this)"/>
      <input type="file" id="jsonInput" accept=".json" style="display:none" onchange="doImportJson(this)"/>
      <span id="importStatus" style="font-size:.85rem;color:#94a3b8"></span>
    </div>
    <p style="font-size:.8rem;color:#64748b;margin-top:.5rem">
      Accepte le ZIP (.env.local + .mosta/apikeys.json) ou le JSON exporté par ornetadmin.
      Après import, redémarrez le serveur pour appliquer les changements.
    </p>
  </div>

  <h2>Console Live <span style="font-size:.75rem;color:#64748b;font-weight:normal">— requêtes en temps réel</span></h2>
  <div class="card">
    <div style="display:flex;gap:.5rem;margin-bottom:.5rem;align-items:center">
      <button class="btn" onclick="startLiveLog()" id="btnLive" style="background:#22c55e">Connecter</button>
      <button class="btn" onclick="clearLiveLog()" style="background:#334155">Clear</button>
      <select id="liveFilter" onchange="filterLiveLog()" style="width:auto">
        <option value="">Tous</option>
        <option value="REST">REST</option>
        <option value="GraphQL">GraphQL</option>
        <option value="JSON-RPC">JSON-RPC</option>
        <option value="WS">WS</option>
        <option value="SSE">SSE</option>
        <option value="MCP">MCP</option>
        <option value="HTTP">HTTP</option>
      </select>
      <span id="liveStatus" style="font-size:.8rem;color:#64748b">Déconnecté</span>
      <span id="liveCount" style="font-size:.8rem;color:#94a3b8;margin-left:auto">0 requêtes</span>
    </div>
    <div id="liveLog" style="background:#0f172a;border-radius:6px;padding:.5rem;max-height:400px;overflow-y:auto;font-family:monospace;font-size:.8rem;line-height:1.6">
      <div style="color:#64748b">En attente de connexion...</div>
    </div>
  </div>

  <h2>Test Connectivité <span style="font-size:.75rem;color:#64748b;font-weight:normal">— tester depuis ornetadmin ou tout client</span></h2>
  <div class="card">
    <p style="font-size:.85rem;color:#94a3b8;margin-bottom:.5rem">Testez la connectivité et les transports depuis n'importe quel client :</p>
    <pre style="background:#0f172a;padding:1rem;border-radius:6px;font-size:.8rem;line-height:1.8;color:#e2e8f0;overflow-x:auto">
<span style="color:#64748b"># Health check</span>
<span style="color:#22c55e">curl</span> http://localhost:${port}/health

<span style="color:#64748b"># REST — lister les entités</span>
<span style="color:#22c55e">curl</span> http://localhost:${port}/api/v1/${schemas[0]?.collection || 'users'}

<span style="color:#64748b"># REST — créer</span>
<span style="color:#22c55e">curl</span> -X POST http://localhost:${port}/api/v1/${schemas[0]?.collection || 'users'} \\
  -H "Content-Type: application/json" -d '{"name":"Test"}'

<span style="color:#64748b"># JSON-RPC</span>
<span style="color:#22c55e">curl</span> -X POST http://localhost:${port}/rpc \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"${schemas[0]?.name || 'User'}.findAll","params":{},"id":1}'

<span style="color:#64748b"># WebSocket</span>
<span style="color:#22c55e">wscat</span> -c ws://localhost:${port}/ws

<span style="color:#64748b"># SSE (événements temps réel)</span>
<span style="color:#22c55e">curl</span> -N http://localhost:${port}/events

<span style="color:#64748b"># Depuis ornetadmin API Explorer</span>
<span style="color:#64748b"># Ouvrir http://localhost:4489/ → API Explorer → Serveur: http://localhost:${port}</span>

<span style="color:#64748b"># Client Java (à venir)</span>
<span style="color:#64748b"># MostaClient client = new MostaClient("http://localhost:${port}");</span>
<span style="color:#64748b"># List&lt;User&gt; users = client.rest().findAll(User.class);</span>
    </pre>
  </div>
</div>

<script>
const BASE='http://localhost:${port}';
const SCHEMAS=${JSON.stringify(schemas.map(s => ({ name: s.name, collection: s.collection })))};

async function doExplore(){
  const transport=document.getElementById('exTransport').value;
  const entityName=document.getElementById('exEntity').value;
  const entity=SCHEMAS.find(s=>s.name===entityName);
  const col=entity?entity.collection:entityName.toLowerCase()+'s';
  const op=document.getElementById('exOp').value;
  const id=document.getElementById('exId').value.trim();
  const body=document.getElementById('exBody').value.trim();
  const apiKey=document.getElementById('exApiKey').value.trim();
  const statusEl=document.getElementById('exStatus');
  const resultEl=document.getElementById('exResult');
  const outputEl=document.getElementById('exOutput');

  statusEl.textContent='Envoi...';
  resultEl.style.display='none';

  const t0=performance.now();
  let url='',method='GET',reqBody=null;
  const headers={'Content-Type':'application/json'};
  if(apiKey)headers['Authorization']='Bearer '+apiKey;

  try{
    if(transport==='rest'){
      switch(op){
        case 'findAll':url=BASE+'/api/v1/'+col;break;
        case 'findById':url=BASE+'/api/v1/'+col+'/'+id;break;
        case 'count':url=BASE+'/api/v1/'+col+'/count';break;
        case 'create':url=BASE+'/api/v1/'+col;method='POST';reqBody=body||'{}';break;
        case 'update':url=BASE+'/api/v1/'+col+'/'+id;method='PUT';reqBody=body||'{}';break;
        case 'delete':url=BASE+'/api/v1/'+col+'/'+id;method='DELETE';break;
      }
    }else if(transport==='graphql'){
      url=BASE+'/graphql';method='POST';
      const e=entityName.charAt(0).toLowerCase()+entityName.slice(1)+'s';
      if(op==='findAll')reqBody=JSON.stringify({query:'{'+e+'{id}}'});
      else if(op==='count')reqBody=JSON.stringify({query:'{'+e+'Count}'});
      else reqBody=body||JSON.stringify({query:'{__schema{types{name}}}'});
    }else if(transport==='jsonrpc'){
      url=BASE+'/rpc';method='POST';
      let params={};
      if(body)try{params=JSON.parse(body)}catch{}
      if(id)params.id=id;
      reqBody=JSON.stringify({jsonrpc:'2.0',method:entityName+'.'+op,params,id:1});
    }

    const opts={method,headers};
    if(reqBody)opts.body=reqBody;
    const r=await fetch(url,opts);
    const ms=Math.round(performance.now()-t0);
    let data;
    try{data=await r.json()}catch{data=await r.text()}

    statusEl.innerHTML='<span style="color:'+(r.ok?'#22c55e':'#ef4444')+'">'+r.status+'</span> — '+ms+'ms — '+method+' '+url;
    outputEl.textContent=typeof data==='string'?data:JSON.stringify(data,null,2);
    resultEl.style.display='block';
  }catch(e){
    statusEl.innerHTML='<span style="color:#ef4444">Erreur: '+e.message+'</span>';
  }
}

// ============================================================
// Import Config (ZIP or JSON)
// ============================================================
function crc32(data){
  let crc=0xFFFFFFFF;
  for(let i=0;i<data.length;i++){crc^=data[i];for(let j=0;j<8;j++)crc=(crc>>>1)^(crc&1?0xEDB88320:0)}
  return (crc^0xFFFFFFFF)>>>0;
}
function parseZip(buf){
  const view=new DataView(buf);
  const files=[];let offset=0;
  while(offset<buf.byteLength-4){
    const sig=view.getUint32(offset,true);
    if(sig!==0x04034b50)break;
    const nameLen=view.getUint16(offset+26,true);
    const extraLen=view.getUint16(offset+28,true);
    const compSize=view.getUint32(offset+18,true);
    const name=new TextDecoder().decode(new Uint8Array(buf,offset+30,nameLen));
    const data=new Uint8Array(buf,offset+30+nameLen+extraLen,compSize);
    files.push({name,content:new TextDecoder().decode(data)});
    offset+=30+nameLen+extraLen+compSize;
  }
  return files;
}
async function doImportZip(input){
  const file=input.files[0];if(!file)return;
  const statusEl=document.getElementById('importStatus');
  try{
    const buf=await file.arrayBuffer();
    const files=parseZip(buf);
    const envFile=files.find(f=>f.name==='.env.local'||f.name==='env.local');
    const keyFile=files.find(f=>f.name.includes('apikeys.json'));
    if(!envFile){statusEl.innerHTML='<span style="color:#ef4444">ZIP invalide: .env.local manquant</span>';return}
    // Parse .env.local into key-value
    const env={};
    for(const line of envFile.content.split('\\n')){
      const trimmed=line.trim();
      if(!trimmed||trimmed.startsWith('#'))continue;
      const eq=trimmed.indexOf('=');
      if(eq>0)env[trimmed.slice(0,eq)]=trimmed.slice(eq+1);
    }
    const body={env};
    if(keyFile)try{body.apikeys=JSON.parse(keyFile.content)}catch{}
    const r=await fetch(BASE+'/api/import-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.ok)statusEl.innerHTML='<span style="color:#22c55e">'+d.message+'</span>';
    else statusEl.innerHTML='<span style="color:#ef4444">'+d.error+'</span>';
  }catch(e){statusEl.innerHTML='<span style="color:#ef4444">'+e.message+'</span>'}
  input.value='';
}
async function doImportJson(input){
  const file=input.files[0];if(!file)return;
  const statusEl=document.getElementById('importStatus');
  try{
    const text=await file.text();
    const data=JSON.parse(text);
    const r=await fetch(BASE+'/api/import-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const d=await r.json();
    if(d.ok)statusEl.innerHTML='<span style="color:#22c55e">'+d.message+'</span>';
    else statusEl.innerHTML='<span style="color:#ef4444">'+d.error+'</span>';
  }catch(e){statusEl.innerHTML='<span style="color:#ef4444">'+e.message+'</span>'}
  input.value='';
}

// ============================================================
// Live Console (SSE)
// ============================================================
let liveSource=null;
let liveEntries=[];
let liveFilter='';
let liveCount=0;

function startLiveLog(){
  if(liveSource){liveSource.close();liveSource=null}
  const btn=document.getElementById('btnLive');
  const statusEl=document.getElementById('liveStatus');
  liveSource=new EventSource(BASE+'/api/live-log');
  liveSource.onopen=()=>{
    statusEl.innerHTML='<span style="color:#22c55e">Connecté</span>';
    btn.textContent='Déconnecter';btn.style.background='#ef4444';
    btn.onclick=stopLiveLog;
  };
  liveSource.onmessage=(e)=>{
    const d=JSON.parse(e.data);
    if(d.type==='connected')return;
    if(d.type==='request'){
      liveCount++;
      document.getElementById('liveCount').textContent=liveCount+' requêtes';
      const colors={REST:'#22c55e',GraphQL:'#a855f7','JSON-RPC':'#f59e0b',WS:'#3b82f6',SSE:'#06b6d4',MCP:'#ec4899',HTTP:'#94a3b8'};
      const sc=d.status<300?'#22c55e':d.status<400?'#fbbf24':'#ef4444';
      const time=d.time.split('T')[1]?.slice(0,8)||'';
      const entry='<div class="live-entry" data-transport="'+d.transport+'">'+
        '<span style="color:#64748b">'+time+'</span> '+
        '<span style="color:'+(colors[d.transport]||'#94a3b8')+'">['+ d.transport+']</span> '+
        '<span style="color:#38bdf8">'+d.method+'</span> '+
        d.url+' '+
        '<span style="color:'+sc+'">'+d.status+'</span> '+
        '<span style="color:#64748b">('+d.ms+'ms)</span>'+
        '</div>';
      liveEntries.push(entry);
      renderLiveLog();
    }
  };
  liveSource.onerror=()=>{
    statusEl.innerHTML='<span style="color:#ef4444">Déconnecté</span>';
    btn.textContent='Reconnecter';btn.style.background='#22c55e';btn.onclick=startLiveLog;
  };
}
function stopLiveLog(){
  if(liveSource){liveSource.close();liveSource=null}
  const btn=document.getElementById('btnLive');
  btn.textContent='Connecter';btn.style.background='#22c55e';btn.onclick=startLiveLog;
  document.getElementById('liveStatus').innerHTML='<span style="color:#64748b">Déconnecté</span>';
}
function clearLiveLog(){liveEntries=[];liveCount=0;document.getElementById('liveCount').textContent='0 requêtes';renderLiveLog()}
function filterLiveLog(){liveFilter=document.getElementById('liveFilter').value;renderLiveLog()}
function renderLiveLog(){
  const el=document.getElementById('liveLog');
  const filtered=liveFilter?liveEntries.filter(e=>e.includes('data-transport="'+liveFilter+'"')):liveEntries;
  if(filtered.length===0){el.innerHTML='<div style="color:#64748b">Aucune requête'+(liveFilter?' (filtre: '+liveFilter+')':'')+'</div>';return}
  el.innerHTML=filtered.slice(-200).join('');
  el.scrollTop=el.scrollHeight;
}

// ============================================================
// Schemas management
// ============================================================
async function loadSchemasConfig(){
  try{
    const r=await fetch(BASE+'/api/schemas-config');
    const d=await r.json();
    const el=document.getElementById('schemasStatus');
    if(d.schemasJsonExists){
      el.innerHTML='<span style="color:#22c55e">schemas.json trouvé</span> — '+d.schemaCount+' schemas';
    }else{
      el.innerHTML='<span style="color:#fbbf24">schemas.json non trouvé</span> — configurez le chemin ou uploadez un ZIP';
    }
    if(d.schemasPath)document.getElementById('schemasPath').value=d.schemasPath;
    renderSchemasTable(d.schemas||[]);
  }catch{}
}
function renderSchemasTable(schemas){
  const el=document.getElementById('schemasTable');
  if(!schemas.length){el.innerHTML='';return}
  el.innerHTML='<table style="width:100%;font-size:.85rem;margin-top:.5rem"><thead><tr><th>Nom</th><th>Collection</th><th>Champs</th><th>Relations</th></tr></thead><tbody>'+
    schemas.map(s=>'<tr><td><b>'+s.name+'</b></td><td class="mono">'+s.collection+'</td><td>'+s.fieldsCount+'</td><td>'+(s.relationsCount||0)+'</td></tr>').join('')+
    '</tbody></table>';
}
async function doScanSchemas(){
  const p=document.getElementById('schemasPath').value.trim();
  if(!p){document.getElementById('schemasMsg').innerHTML='<span style="color:#ef4444">Chemin requis</span>';return}
  document.getElementById('schemasMsg').textContent='Scan en cours...';
  const r=await fetch(BASE+'/api/scan-schemas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p})});
  const d=await r.json();
  if(d.ok){
    document.getElementById('schemasMsg').innerHTML='<span style="color:#22c55e">'+d.count+' schemas trouvés</span>';
    renderSchemasTable(d.schemas||[]);
  }else{
    document.getElementById('schemasMsg').innerHTML='<span style="color:#ef4444">'+(d.error||'Erreur')+'</span>';
  }
}
async function doGenerateSchemas(){
  const p=document.getElementById('schemasPath').value.trim();
  if(!p){document.getElementById('schemasMsg').innerHTML='<span style="color:#ef4444">Chemin requis</span>';return}
  document.getElementById('schemasMsg').textContent='Génération...';
  const r=await fetch(BASE+'/api/generate-schemas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p})});
  const d=await r.json();
  if(d.ok){
    document.getElementById('schemasMsg').innerHTML='<span style="color:#22c55e">schemas.json généré ('+d.count+' schemas)</span>';
    loadSchemasConfig();
  }else{
    document.getElementById('schemasMsg').innerHTML='<span style="color:#ef4444">'+(d.error||'Erreur')+'</span>';
  }
}
async function doUploadSchemasZip(input){
  const file=input.files[0];if(!file)return;
  document.getElementById('schemasMsg').textContent='Upload...';
  try{
    const buf=await file.arrayBuffer();
    const base64=btoa(String.fromCharCode(...new Uint8Array(buf)));
    const r=await fetch(BASE+'/api/upload-schemas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zip:base64})});
    const d=await r.json();
    if(d.ok){
      document.getElementById('schemasMsg').innerHTML='<span style="color:#22c55e">'+d.count+' schemas importés depuis ZIP</span>';
      loadSchemasConfig();
    }else{
      document.getElementById('schemasMsg').innerHTML='<span style="color:#ef4444">'+(d.error||'Erreur')+'</span>';
    }
  }catch(e){document.getElementById('schemasMsg').innerHTML='<span style="color:#ef4444">'+e.message+'</span>'}
  input.value='';
}
// Load schemas config on page load
loadSchemasConfig();

// ============================================================
// Database management
// ============================================================
async function doReconnect(){
  const el=document.getElementById('dbStatus');
  el.textContent='Reconnexion...';
  try{
    const r=await fetch(BASE+'/api/reconnect',{method:'POST'});
    const d=await r.json();
    el.innerHTML=d.ok?'<span style="color:#22c55e">✅ '+d.message+'</span>':'<span style="color:#ef4444">❌ '+(d.error||'Erreur')+'</span>';
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
async function doTestConn(){
  const el=document.getElementById('dbStatus');
  el.textContent='Test en cours...';
  try{
    const r=await fetch(BASE+'/api/test-connection',{method:'POST'});
    const d=await r.json();
    el.innerHTML=d.ok?'<span style="color:#22c55e">✅ '+d.message+'</span>':'<span style="color:#ef4444">❌ '+d.message+'</span>';
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
async function doCreateDb(){
  const el=document.getElementById('dbStatus');
  el.textContent='Création...';
  try{
    const r=await fetch(BASE+'/api/create-database',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const d=await r.json();
    el.innerHTML=d.ok?'<span style="color:#22c55e">✅ '+d.message+'</span>':'<span style="color:#ef4444">❌ '+(d.error||d.message)+'</span>';
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
async function doApplySchema(){
  const el=document.getElementById('dbStatus');
  el.textContent='Application du schéma...';
  try{
    const r=await fetch(BASE+'/api/apply-schema',{method:'POST'});
    const d=await r.json();
    if(d.ok){
      el.innerHTML='<span style="color:#22c55e">✅ '+d.message+'</span>';
    }else{
      el.innerHTML='<span style="color:#ef4444">❌ '+(d.error||'Erreur')+'</span>';
    }
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
</script>
</body>
</html>`;
}
