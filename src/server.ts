// @mostajs/net — Main server orchestrator
// Loads config, connects ORM, starts transports, wires everything together
// Author: Dr Hamid MADANI drmdh@msn.com

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { EntityService, getAllSchemas, getDialect, registerSchemas, getSchemaByCollection } from '@mostajs/orm';
import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import { ProjectManager } from '@mostajs/mproject';
import type { ProjectConfig } from '@mostajs/mproject';
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
import { TrpcTransport } from './transports/trpc.transport.js';
import { ODataTransport } from './transports/odata.transport.js';
import { getHelpTabHtml, getHelpTabScript } from './views/help.js';
import { GrpcTransport } from './transports/grpc.transport.js';
import { NatsTransport } from './transports/nats.transport.js';
import { ArrowFlightTransport } from './transports/arrow.transport.js';

export interface NetServer {
  app: FastifyInstance;
  entityService: EntityService;
  pm: ProjectManager;
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
  // 0. Catch unhandled errors (some DB drivers emit fatal errors outside Promises)
  process.on('uncaughtException', (err) => {
    console.error(`\n  \x1b[31m⚠ Erreur non-catchée:\x1b[0m ${err.message}`);
    console.error(`  Le serveur continue — corrigez la config DB depuis l'IHM\n`);
  });

  // 1. Load net config
  const config = loadNetConfig();

  // 2. Connect ORM (non-blocking — server starts even if DB is unavailable)
  let dialect: import('@mostajs/orm').IDialect | null = null;
  let entityService: EntityService | null = null;
  let dbError = '';

  try {
    if (!process.env.DB_DIALECT || !process.env.SGBD_URI) {
      throw new Error('DB_DIALECT et SGBD_URI non configurés — utilisez l\'IHM pour choisir un dialecte');
    }
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

  // 3b. Initialize ProjectManager + MCP ref
  const pm = new ProjectManager();
  let mcpTransportRef: McpTransport | null = null;
  if (dialect && entityService) {
    pm.setDefault('default', dialect, []);
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

  // 4b. Re-init dialect with loaded schemas (so relations/junction tables work)
  if (dialect && schemas.length > 0) {
    await dialect.initSchema(schemas);
  }

  // 4c. Update default project with loaded schemas
  if (dialect && schemas.length > 0) {
    pm.setDefault('default', dialect, schemas);
  }

  // 4d. Load additional projects + enable auto-persistence
  const projectsFile = process.env.MOSTA_PROJECTS || 'projects-tree.json';
  pm.enableAutoPersist(projectsFile);

  try {
    const { existsSync } = await import('fs');
    if (existsSync(projectsFile)) {
      await pm.loadFromFile(projectsFile);
      console.log(`  Loaded ${pm.size - 1} additional project(s) from ${projectsFile}`);
    }
  } catch (e) {
    console.warn(`  ⚠ Failed to load projects from ${projectsFile}:`, e instanceof Error ? e.message : e);
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
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 }); // 10 MB

  // CORS — allow cross-origin requests (ornetadmin API Explorer, Studio, etc.)
  const cors = (await import('@fastify/cors')).default;
  await app.register(cors, { origin: true });

  // 5c. Performance tracker + Rate limiter
  const perfStats = {
    startedAt: Date.now(),
    totalRequests: 0,
    totalErrors: 0,
    latencies: [] as number[],   // rolling window of last 1000 latencies
    requestsPerSecond: 0,
    perClient: new Map<string, { count: number; lastReset: number }>(),
    perProject: new Map<string, { count: number; errors: number; latencies: number[] }>(),
    rateLimitPerClient: parseInt(process.env.MOSTA_RATE_LIMIT_CLIENT || '1000'),  // req/min
    rateLimitPerProject: parseInt(process.env.MOSTA_RATE_LIMIT_PROJECT || '10000'), // req/min
    rejected: 0,
  };

  // Calculate P50/P99 from sorted latencies
  const percentile = (arr: number[], p: number): number => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, idx)];
  };

  // RPS calculator (every 5s)
  let rpsCounter = 0;
  setInterval(() => {
    perfStats.requestsPerSecond = Math.round(rpsCounter / 5);
    rpsCounter = 0;
  }, 5000);

  // Rate limit check
  const checkRateLimit = (clientIp: string): boolean => {
    const now = Date.now();
    let client = perfStats.perClient.get(clientIp);
    if (!client || now - client.lastReset > 60000) {
      client = { count: 0, lastReset: now };
      perfStats.perClient.set(clientIp, client);
    }
    client.count++;
    return client.count <= perfStats.rateLimitPerClient;
  };

  // Rate limit hook (skip admin API routes)
  app.addHook('onRequest', (req, reply, done) => {
    // Skip rate limit for admin routes
    if (!req.url.startsWith('/api/v1/') && !req.url.startsWith('/graphql') && !req.url.startsWith('/mcp')) {
      done(); return;
    }
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      perfStats.rejected++;
      reply.status(429).send({ status: 'error', error: { code: 'RATE_LIMITED', message: `Rate limit exceeded (${perfStats.rateLimitPerClient} req/min)` } });
      return;
    }
    done();
  });

  // 5d. Request logger + metrics collector
  app.addHook('onResponse', (req, reply, done) => {
    const ms = reply.elapsedTime || 0;
    const status = reply.statusCode;
    const method = req.method;
    const url = req.url;

    // Track metrics
    perfStats.totalRequests++;
    rpsCounter++;
    if (status >= 400) perfStats.totalErrors++;
    perfStats.latencies.push(ms);
    if (perfStats.latencies.length > 1000) perfStats.latencies.shift();

    // Track per-project metrics
    const projectMatch = url.match(/^\/api\/v1\/([^/]+)\//);
    if (projectMatch && pm.hasProject(projectMatch[1])) {
      const pName = projectMatch[1];
      let pStats = perfStats.perProject.get(pName);
      if (!pStats) { pStats = { count: 0, errors: 0, latencies: [] }; perfStats.perProject.set(pName, pStats); }
      pStats.count++;
      if (status >= 400) pStats.errors++;
      pStats.latencies.push(ms);
      if (pStats.latencies.length > 200) pStats.latencies.shift();
    }

    // Detect transport from URL
    let transport = 'HTTP';
    if (url.startsWith('/api/v1/')) transport = 'REST';
    else if (url.startsWith('/graphql')) transport = 'GraphQL';
    else if (url.startsWith('/rpc')) transport = 'JSON-RPC';
    else if (url.startsWith('/ws')) transport = 'WS';
    else if (url.startsWith('/events')) transport = 'SSE';
    else if (url.startsWith('/mcp')) transport = 'MCP';

    const statusColor = status < 300 ? C.green : status < 400 ? C.yellow : C.magenta;
    console.log(`${C.dim}[NET:${C.cyan}${transport}${C.dim}]${C.reset} ${C.blue}${method}${C.reset} ${url} ${statusColor}${status}${C.reset} ${C.gray}(${ms.toFixed(0)}ms)${C.reset}`);
    done();
  });

  // 6. ORM handler — context-aware via ProjectManager
  const ormHandler = async (req: OrmRequest, ctx: TransportContext): Promise<OrmResponse> => {
    // Resolve the right EntityService for this project
    const es = pm.resolveEntityService(ctx.projectName);
    if (!es) {
      const projectMsg = ctx.projectName ? `Projet "${ctx.projectName}" non trouvé` : 'Base de donnees non connectee';
      return { status: 'error', data: null, error: { code: 'DB_NOT_CONNECTED', message: projectMsg + ': ' + (dbError || 'configurez DB_DIALECT + SGBD_URI') } };
    }
    return es.execute(req);
  };

  // 7. Load and start enabled transports
  const enabledNames = getEnabledTransports(config);

  for (const name of enabledNames) {
    const transportConfig = config.transports[name];
    let transport: import('./core/types.js').ITransport | null = null;
    try {
      transport = await getTransport(name, transportConfig);
    } catch (e: unknown) {
      console.warn(`  \x1b[33m⚠\x1b[0m Transport "${name}" failed to load: ${e instanceof Error ? e.message : e}`);
      continue;
    }

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

    // Start the transport (non-blocking — continue even if start fails)
    try {
      await transport.start(transportConfig);
    } catch (e: unknown) {
      console.warn(`  \x1b[33m⚠\x1b[0m Transport "${name}" start failed: ${e instanceof Error ? e.message : e}`);
      console.warn(`    Transport continues in degraded mode (HTTP endpoints may still work)`);
    }

    // Mount REST routes on the shared Fastify instance
    // Routes are GENERIC (/:collection) — resolves entity at runtime
    // This allows hot-reload when schemas are uploaded via /api/upload-schemas-json
    if (transport instanceof RestTransport) {
      registerDynamicRestRoutes(app, ormHandler, pm);
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
      mcpTransport.setProjectsProvider(() =>
        pm.listProjects().map(p => ({ name: p.name, schemas: pm.getProject(p.name)?.schemas || [] }))
      );
      mcpTransportRef = mcpTransport; // Store ref for MCP Agent Simulator
      const mcpPath = mcpTransport.getPath();

      // MCP uses raw Node.js request/response for streaming
      app.all(mcpPath, async (req, reply) => {
        reply.hijack();
        await mcpTransport.handleRequest(req.raw, reply.raw, req.body);
      });
    }

    // Mount tRPC endpoint
    if (transport instanceof TrpcTransport) {
      const trpcTransport = transport;
      trpcTransport.setHandler(ormHandler);
      const trpcPath = trpcTransport.getPath();

      // tRPC uses POST for mutations and GET for queries — both route to handleRequest
      app.all(`${trpcPath}/*`, async (req, reply) => {
        const result = await trpcTransport.handleRequest(req.url, req.body as any);
        return result;
      });

      // List procedures
      app.get(trpcPath, async () => ({
        procedures: trpcTransport.listProcedures(),
        types: trpcTransport.generateTypes(),
      }));
    }

    // Mount OData endpoint
    if (transport instanceof ODataTransport) {
      const odataTransport = transport;
      odataTransport.setHandler(ormHandler);
      const odataPath = odataTransport.getPath();

      // OData $metadata
      app.get(`${odataPath}/$metadata`, async (req, reply) => {
        reply.type('application/xml');
        return odataTransport.generateMetadata();
      });

      // OData CRUD — all methods
      app.all(`${odataPath}/*`, async (req, reply) => {
        const q = req.query as Record<string, string>;
        const result = await odataTransport.handleRequest(req.method, req.url, q, req.body);
        reply.status(result.status);
        if (result.data === null) { reply.send(); return; }
        return result.data;
      });
    }

    // Mount gRPC (info only — actual gRPC server requires @grpc/grpc-js)
    if (transport instanceof GrpcTransport) {
      const grpcTransport = transport;
      grpcTransport.setHandler(ormHandler);

      // Expose proto and service info via REST (for development/debugging)
      app.get('/api/grpc/proto', async (req, reply) => {
        reply.type('text/plain');
        return grpcTransport.getProto();
      });

      app.get('/api/grpc/services', async () => {
        return {
          services: Object.keys(grpcTransport.getServices()),
          proto: 'GET /api/grpc/proto',
        };
      });
    }

    // Mount NATS (connects to NATS server + HTTP proxy endpoints)
    if (transport.name === 'nats') {
      const natsTransport = transport as any;
      natsTransport.setHandler(ormHandler);

      // HTTP proxy for NATS (when NATS server is unavailable or for testing)
      app.get('/api/nats/subjects', async () => natsTransport.getSubjects());
      app.get('/api/nats/info', async () => natsTransport.getInfo());
      app.post('/api/nats/call', async (req) => {
        const body = req.body as { entity: string; op: string; params?: any };
        if (!body?.entity || !body?.op) return { status: 'error', error: { message: 'entity and op required' } };
        return natsTransport.handleHttpProxy(body.op, body.entity, body.params || {});
      });
    }

    // Mount Arrow Flight (HTTP endpoints for columnar data)
    if (transport.name === 'arrow') {
      const arrowTransport = transport as any;
      arrowTransport.setHandler(ormHandler);
      const arrowPath = arrowTransport.getPath();

      app.all(`${arrowPath}/*`, async (req, reply) => {
        const result = await arrowTransport.handleRequest(req.method, req.url, req.body);
        reply.status(result.status);
        if (result.contentType) reply.type(result.contentType);
        return result.data;
      });

      app.get(arrowPath, async () => {
        return arrowTransport.handleRequest('GET', '/arrow/flights').then((r: any) => r.data);
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

  // 8e. Compare schema — delegates to ORM diffSchemas()
  app.post('/api/compare-schema', async (req) => {
    const { schema } = req.body as { schema: any };
    if (!schema?.name) return { data: { compatible: false, exists: false, diffs: [], error: 'schema.name required' } };

    const existing = getAllSchemas().find(s => s.name === schema.name);
    if (!existing) {
      return { data: { compatible: false, exists: false, diffs: [] } };
    }

    try {
      const { diffSchemas } = await import('@mostajs/orm');
      const diffs = diffSchemas([existing], [schema]);
      return {
        data: {
          compatible: diffs.length === 0,
          exists: true,
          diffs: diffs.map((d: any) => ({ type: d.type, field: d.field ?? d.collection, detail: d.detail ?? d.type })),
        },
      };
    } catch {
      // diffSchemas not available — fallback to name check only
      return { data: { compatible: true, exists: true, diffs: [] } };
    }
  });

  // 8f. Receive schemas from client (setup wizard sends them by HTTP)
  app.post('/api/upload-schemas-json', async (req) => {
    const body = req.body as { schemas?: any[] };
    if (!body?.schemas?.length) return { ok: false, error: 'No schemas provided' };
    try {
      // Register schemas in ORM
      registerSchemas(body.schemas);
      // Re-init dialect with new schemas (create tables if strategy=update)
      if (dialect) {
        await dialect.initSchema(getAllSchemas());
      }
      // Save schemas.json for next startup
      const fs = await import('fs');
      fs.writeFileSync('schemas.json', JSON.stringify(body.schemas, null, 2));
      // Schemas sauvés + tables créées — redémarrage pour enregistrer les routes
      // Délai 2s pour laisser la réponse HTTP arriver au client avant exit
      console.log(`\n  📦 ${body.schemas.length} schemas reçus et sauvés — redémarrage dans 2s...\n`);
      setTimeout(() => process.exit(0), 2000);
      return { ok: true, count: body.schemas.length, needsRestart: true, schemas: body.schemas.map((s: any) => s.name) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

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
  app.post('/api/test-connection', async (req) => {
    const body = req.body as { dialect?: string; uri?: string } | null;

    // If body has dialect+uri, test that specific connection (from project form)
    if (body?.dialect && body?.uri) {
      try {
        const { testConnection } = await import('@mostajs/orm');
        const result = await testConnection({ dialect: body.dialect as any, uri: body.uri });
        return {
          ok: result.ok,
          message: result.ok ? 'Connexion reussie' : (result.error || 'Echec'),
          dialect: body.dialect,
          error: result.error,
        };
      } catch (e: unknown) {
        return { ok: false, message: e instanceof Error ? e.message : 'Erreur' };
      }
    }

    // Default: test the current dialect (project default)
    if (!dialect) return { ok: false, message: 'DB non connectee: ' + dbError };
    try {
      const ok = await dialect.testConnection();
      if (!ok) return { ok: false, message: 'Echec de connexion' };

      const registeredSchemas = getAllSchemas().map(s => ({
        name: s.name,
        collection: s.collection,
        fields: Object.keys(s.fields || {}).length,
        relations: Object.keys(s.relations || {}).length,
      }));

      let dbTables: string[] = [];
      try {
        if ((dialect as any).getTableListQuery) {
          const query = (dialect as any).getTableListQuery();
          const rows = await (dialect as any).executeQuery(query, []);
          dbTables = rows.map((r: any) =>
            r.name || r.TABLE_NAME || r.table_name || Object.values(r)[0]
          ).filter(Boolean) as string[];
        }
      } catch {}

      return {
        ok: true,
        message: `Connexion reussie — ${dbTables.length} tables, ${registeredSchemas.length} schemas`,
        dialect: (dialect as any).dialectType,
        tables: dbTables,
        schemas: registeredSchemas,
      };
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : 'Erreur' };
    }
  });

  app.post('/api/reconnect', async () => {
    try {
      // Force new connection (disconnect singleton first)
      const { disconnectDialect } = await import('@mostajs/orm');
      try { await disconnectDialect(); } catch {}
      dialect = await getDialect();
      entityService = new EntityService(dialect);
      // Re-init schemas if available
      const currentSchemas = getAllSchemas();
      if (currentSchemas.length > 0) {
        await dialect.initSchema(currentSchemas);
      }
      dbError = '';
      return { ok: true, message: 'Reconnexion reussie (' + currentSchemas.length + ' schemas)' };
    } catch (e: unknown) {
      dbError = e instanceof Error ? e.message : String(e);
      return { ok: false, error: dbError };
    }
  });

  // 8g. Change dialect at runtime (config only — no migration, no auto-reconnect)
  app.post('/api/change-dialect', async (req) => {
    const body = req.body as { dialect?: string; uri?: string; connect?: boolean };
    if (!body?.dialect || !body?.uri) {
      return { ok: false, error: 'dialect et uri requis' };
    }
    try {
      // 1. Disconnect current dialect
      const { disconnectDialect } = await import('@mostajs/orm');
      try { await disconnectDialect(); } catch {}
      dialect = null;
      entityService = null;

      // 2. Update process.env
      process.env.DB_DIALECT = body.dialect;
      process.env.SGBD_URI = body.uri;
      process.env.DB_SCHEMA_STRATEGY = 'update';

      // 3. Update env file — write to .env.local if exists, else .env
      //    Priority: .env.local > .env (same as Node.js/Next.js convention)
      const fs = await import('fs');
      const envPath = fs.existsSync('.env.local') ? '.env.local' : '.env';
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        const cleaned: string[] = [];
        let dbDialectWritten = false;
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip ALL DB_DIALECT and SGBD_URI lines (active or commented from change-dialect)
          if (/^#?DB_DIALECT=/.test(trimmed) || /^#?SGBD_URI=/.test(trimmed)) {
            // Keep the original commented templates (from the header)
            if (trimmed.startsWith('#') && !dbDialectWritten) {
              // Keep only if it's a template (has a known dialect prefix)
              const isTemplate = /^#DB_DIALECT=(sqlite|postgres|oracle|mongodb|mysql|mariadb|mssql)$/.test(trimmed)
                || /^#SGBD_URI=(sqlite|postgresql|oracle|mongodb|mysql|mariadb|mssql):/.test(trimmed)
                || /^#SGBD_URI=\.\//.test(trimmed);
              if (isTemplate) { cleaned.push(line); continue; }
            }
            continue; // Skip duplicates and active lines
          }
          cleaned.push(line);
        }
        // Add active lines at the end
        cleaned.push('DB_DIALECT=' + body.dialect);
        cleaned.push('SGBD_URI=' + body.uri);
        fs.writeFileSync(envPath, cleaned.join('\n') + '\n');
      }

      // 4. Si connect demandé, reconnecter
      if (body.connect) {
        dialect = await getDialect();
        entityService = new EntityService(dialect);
        const currentSchemas = getAllSchemas();
        if (currentSchemas.length > 0) {
          await dialect.initSchema(currentSchemas);
      }

        dbError = '';
        return { ok: true, connected: true, message: `Dialecte changé et connecté : ${body.dialect} (${currentSchemas.length} schemas)` };
      }

      // Sans connect : juste la config
      dbError = '';
      return { ok: true, connected: false, message: `Config changée : ${body.dialect} — utilisez "Reconnecter" pour se connecter` };
    } catch (e: unknown) {
      dbError = e instanceof Error ? e.message : String(e);
      return { ok: false, error: dbError };
    }
  });

  // 8g2. Restart server (used after config change — relies on start script loop)
  app.post('/api/restart', async () => {
    console.log('\n  🔄 Redémarrage demandé via IHM...\n');
    setTimeout(() => process.exit(0), 500);
    return { ok: true, message: 'Redémarrage en cours...' };
  });

  // 8h. Unload schemas (remove from memory registry, delete schemas.json)
  app.post('/api/unload-schemas', async () => {
    try {
      const { clearRegistry } = await import('@mostajs/orm');
      const count = getAllSchemas().length;
      clearRegistry();
      // Supprimer schemas.json pour qu'il ne soit pas rechargé au prochain démarrage
      const fs = await import('fs');
      try { fs.unlinkSync('schemas.json'); } catch {}
      return { ok: true, message: `${count} schemas déchargés — schemas.json supprimé` };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // 8i. Truncate tables (empty data, keep structure — via ORM dialect.truncateAll)
  app.post('/api/truncate-tables', async (req) => {
    const body = req.body as { confirm?: boolean };
    if (!body?.confirm) return { ok: false, error: 'Confirmation requise : { "confirm": true }' };
    if (!dialect) return { ok: false, error: 'DB non connectée' };
    try {
      if (dialect.truncateAll) {
        const truncated = await dialect.truncateAll(getAllSchemas());
        return { ok: true, message: `${truncated.length} tables vidées`, truncated };
      }
      return { ok: false, error: 'Ce dialecte ne supporte pas truncateAll' };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // 8j. Drop tables (dangerous — drops actual DB tables via ORM dialect)
  app.post('/api/drop-tables', async (req) => {
    const body = req.body as { confirm?: boolean; all?: boolean };
    if (!body?.confirm) {
      return { ok: false, error: 'Confirmation requise : { "confirm": true }' };
    }
    if (!dialect) {
      return { ok: false, error: 'DB non connectée' };
    }
    try {
      if (body.all && dialect.dropAllTables) {
        await dialect.dropAllTables();
        return { ok: true, message: 'Toutes les tables supprimées' };
      } else if (dialect.dropSchema) {
        const currentSchemas = getAllSchemas();
        const dropped = await dialect.dropSchema(currentSchemas);
        return { ok: true, message: `${dropped.length} tables supprimées`, dropped };
      } else {
        return { ok: false, error: 'Ce dialecte ne supporte pas dropSchema' };
      }
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post('/api/reload-config', async () => {
    try {
      // 1. Reload env files (.env then .env.local — local overrides base)
      const fs = await import('fs');
      const path = await import('path');
      for (const envFile of ['.env', '.env.local']) {
        const envPath = path.resolve(process.cwd(), envFile);
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
          }
        }
      }

      // 2. Disconnect current DB
      const { disconnectDialect } = await import('@mostajs/orm');
      try { await disconnectDialect(); } catch {}
      dialect = null;
      entityService = null;

      // 3. Try reconnect with new config (non-blocking)
      const newDialect = process.env.DB_DIALECT || 'unknown';
      const newUri = (process.env.SGBD_URI || '').replace(/:([^@]+)@/, ':***@');
      try {
        if (process.env.DB_DIALECT && process.env.SGBD_URI) {
          dialect = await getDialect();
          entityService = new EntityService(dialect);
          const currentSchemas = getAllSchemas();
          if (currentSchemas.length > 0) {
            await dialect.initSchema(currentSchemas);
          }
          dbError = '';
          return { ok: true, message: 'Config rechargee et connectee — ' + newDialect + ' (' + newUri + ')' };
        }
      } catch (e: unknown) {
        dbError = e instanceof Error ? e.message : String(e);
      }

      // Config rechargée même si la connexion a échoué
      return { ok: true, message: 'Config rechargee — ' + newDialect + ' (' + newUri + ')' + (dbError ? ' — ⚠ ' + dbError : '') };
    } catch (e: unknown) {
      return { ok: true, message: 'Config rechargee — erreur: ' + (e instanceof Error ? e.message : String(e)) };
    }
  });

  app.post('/api/create-database', async (req) => {
    const body = req.body as { name?: string; dialect?: string; uri?: string } | null;
    // Use body values if provided (from project form), fallback to env (default project)
    const dbDialect = body?.dialect || process.env.DB_DIALECT || '';
    const uri = body?.uri || process.env.SGBD_URI || '';
    if (!dbDialect || !uri) return { ok: false, error: 'dialect et uri requis' };
    try {
      const { createDatabase } = await import('@mostajs/orm');
      const dbName = body?.name || uri.split('/').pop()?.split('?')[0] || '';
      if (!dbName) return { ok: false, error: 'Nom de base non detecte dans l\'URI' };
      await createDatabase(dbDialect as any, uri, dbName);
      return { ok: true, message: 'Base "' + dbName + '" creee' };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      if (msg.includes('already exists') || msg.includes('existe')) return { ok: true, message: 'Base "' + (body?.name || '') + '" existe deja' };
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

  // ── Multi-project API (/api/projects) ──

  app.get('/api/projects', async () => pm.listProjects());

  app.post('/api/projects', async (req, reply) => {
    const body = req.body as ProjectConfig;
    if (!body.name || !body.dialect || !body.uri) {
      reply.status(400);
      return { ok: false, error: 'name, dialect et uri sont requis' };
    }
    try {
      await pm.addProject(body);
      return { ok: true, projects: pm.listProjects() };
    } catch (e: unknown) {
      reply.status(400);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.put('/api/projects/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as Partial<ProjectConfig>;
    try {
      await pm.updateProject(name, body);
      return { ok: true, projects: pm.listProjects() };
    } catch (e: unknown) {
      reply.status(400);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.delete('/api/projects/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      await pm.removeProject(name);
      return { ok: true, projects: pm.listProjects() };
    } catch (e: unknown) {
      reply.status(404);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post('/api/projects/:name/test', async (req, reply) => {
    const { name } = req.params as { name: string };
    const project = pm.getProject(name);
    if (!project) { reply.status(404); return { ok: false, error: `Projet "${name}" non trouve` }; }
    try {
      const ok = await project.dialect.testConnection();
      return { ok, project: name, status: project.status };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.get('/api/projects/pool-stats', async () => pm.getPoolStats());

  // ── Performance API ──

  app.get('/api/performance', async () => {
    const uptime = Math.round((Date.now() - perfStats.startedAt) / 1000);
    const perProject: Record<string, any> = {};
    for (const [name, s] of perfStats.perProject) {
      perProject[name] = {
        requests: s.count,
        errors: s.errors,
        p50: Math.round(percentile(s.latencies, 50) * 100) / 100,
        p99: Math.round(percentile(s.latencies, 99) * 100) / 100,
      };
    }
    return {
      uptime,
      totalRequests: perfStats.totalRequests,
      totalErrors: perfStats.totalErrors,
      requestsPerSecond: perfStats.requestsPerSecond,
      p50: Math.round(percentile(perfStats.latencies, 50) * 100) / 100,
      p99: Math.round(percentile(perfStats.latencies, 99) * 100) / 100,
      rateLimiting: {
        perClient: perfStats.rateLimitPerClient,
        perProject: perfStats.rateLimitPerProject,
        rejected: perfStats.rejected,
      },
      pool: pm.getPoolStats(),
      perProject,
    };
  });

  app.put('/api/performance/rate-limit', async (req) => {
    const body = req.body as { perClient?: number; perProject?: number };
    if (body.perClient) perfStats.rateLimitPerClient = body.perClient;
    if (body.perProject) perfStats.rateLimitPerProject = body.perProject;
    return { ok: true, perClient: perfStats.rateLimitPerClient, perProject: perfStats.rateLimitPerProject };
  });

  // ── MCP Agent Simulator API (REST proxy for browser) ──

  app.get('/api/mcp-agent/info', async () => {
    if (!mcpTransportRef) return { error: 'MCP transport not active' };
    return mcpTransportRef.getServerInfo();
  });

  app.get('/api/mcp-agent/tools', async () => {
    if (!mcpTransportRef) return [];
    return mcpTransportRef.listTools();
  });

  app.get('/api/mcp-agent/prompts', async () => {
    if (!mcpTransportRef) return [];
    return mcpTransportRef.listPrompts();
  });

  app.post('/api/mcp-agent/call', async (req) => {
    if (!mcpTransportRef) return { status: 'error', error: { code: 'MCP_NOT_ACTIVE', message: 'MCP transport not active. Enable MOSTA_NET_MCP_ENABLED=true' } };
    const body = req.body as { tool: string; params?: Record<string, any> };
    if (!body?.tool) return { status: 'error', error: { code: 'MISSING_TOOL', message: 'tool name required' } };
    try {
      const result = await mcpTransportRef.executeTool(body.tool, body.params || {});
      return result;
    } catch (e: unknown) {
      return { status: 'error', error: { code: 'TOOL_ERROR', message: e instanceof Error ? e.message : String(e) } };
    }
  });

  // ── Config Tree API ──

  app.get('/api/config-tree', async () => {
    const { readFileSync, existsSync } = await import('fs');
    const { resolve: resolvePath } = await import('path');

    // Parse .env.local into a tree structure
    const envPath = resolvePath(process.cwd(), '.env.local');
    const envFile = resolvePath(process.cwd(), '.env');
    const filePath = existsSync(envPath) ? envPath : existsSync(envFile) ? envFile : null;

    const tree: Record<string, any> = {
      database: {
        dialect: process.env.DB_DIALECT || '',
        uri: (process.env.SGBD_URI || '').replace(/:([^@]+)@/, ':***@'),
        schemaStrategy: process.env.DB_SCHEMA_STRATEGY || 'none',
        showSql: process.env.DB_SHOW_SQL === 'true',
        formatSql: process.env.DB_FORMAT_SQL === 'true',
        highlightSql: process.env.DB_HIGHLIGHT_SQL === 'true',
        poolSize: process.env.DB_POOL_SIZE || '10',
        batchSize: process.env.DB_BATCH_SIZE || '100',
      },
      server: {
        port: process.env.MOSTA_NET_PORT || '4488',
        projectsFile: process.env.MOSTA_PROJECTS || 'projects-tree.json',
      },
      transports: {
        rest: process.env.MOSTA_NET_REST_ENABLED === 'true',
        graphql: process.env.MOSTA_NET_GRAPHQL_ENABLED === 'true',
        ws: process.env.MOSTA_NET_WS_ENABLED === 'true',
        sse: process.env.MOSTA_NET_SSE_ENABLED === 'true',
        jsonrpc: process.env.MOSTA_NET_JSONRPC_ENABLED === 'true',
        mcp: process.env.MOSTA_NET_MCP_ENABLED === 'true',
      },
      projects: pm.listProjects(),
    };

    return { tree, file: filePath, raw: filePath ? readFileSync(filePath, 'utf-8') : null };
  });

  app.post('/api/config-tree', async (req) => {
    const body = req.body as { key: string; value: string };
    if (!body?.key) return { ok: false, error: 'key requis' };

    const { readFileSync, writeFileSync, existsSync } = await import('fs');
    const { resolve: resolvePath } = await import('path');

    // Map tree keys to env var names
    const keyMap: Record<string, string> = {
      'database.dialect': 'DB_DIALECT',
      'database.uri': 'SGBD_URI',
      'database.schemaStrategy': 'DB_SCHEMA_STRATEGY',
      'database.showSql': 'DB_SHOW_SQL',
      'database.formatSql': 'DB_FORMAT_SQL',
      'database.highlightSql': 'DB_HIGHLIGHT_SQL',
      'database.poolSize': 'DB_POOL_SIZE',
      'database.batchSize': 'DB_BATCH_SIZE',
      'server.port': 'MOSTA_NET_PORT',
      'server.projectsFile': 'MOSTA_PROJECTS',
      'transports.rest': 'MOSTA_NET_REST_ENABLED',
      'transports.graphql': 'MOSTA_NET_GRAPHQL_ENABLED',
      'transports.ws': 'MOSTA_NET_WS_ENABLED',
      'transports.sse': 'MOSTA_NET_SSE_ENABLED',
      'transports.jsonrpc': 'MOSTA_NET_JSONRPC_ENABLED',
      'transports.mcp': 'MOSTA_NET_MCP_ENABLED',
      'transports.grpc': 'MOSTA_NET_GRPC_ENABLED',
      'transports.trpc': 'MOSTA_NET_TRPC_ENABLED',
      'transports.odata': 'MOSTA_NET_ODATA_ENABLED',
      'transports.nats': 'MOSTA_NET_NATS_ENABLED',
      'transports.arrow': 'MOSTA_NET_ARROW_ENABLED',
    };

    // Check if key is a project property (e.g. "projects.analytics.dialect")
    if (body.key.startsWith('projects.')) {
      const parts = body.key.replace('projects.', '').split('.');
      // parts[0] = project name, parts[1..] = property path
      if (parts.length >= 2) {
        const projectsPath = resolvePath(process.cwd(), process.env.MOSTA_PROJECTS || 'projects-tree.json');
        let tree: Record<string, any> = {};
        try { tree = JSON.parse(readFileSync(projectsPath, 'utf-8')); } catch {}
        const projName = parts[0];
        if (!tree[projName]) tree[projName] = {};
        let obj = tree[projName];
        for (let i = 1; i < parts.length - 1; i++) {
          if (!obj[parts[i]]) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = body.value;
        writeFileSync(projectsPath, JSON.stringify(tree, null, 2), 'utf-8');
        return { ok: true, key: body.key, file: 'projects-tree.json', value: body.value };
      }
    }

    const envVar = keyMap[body.key];
    if (!envVar) return { ok: false, error: `Cle inconnue: ${body.key}` };

    // Update process.env
    process.env[envVar] = body.value;

    // Update .env file
    const envPath = resolvePath(process.cwd(), '.env');
    let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
    const regex = new RegExp(`^${envVar}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${envVar}=${body.value}`);
    } else {
      content += `\n${envVar}=${body.value}`;
    }
    writeFileSync(envPath, content, 'utf-8');

    return { ok: true, key: body.key, envVar, file: '.env', value: body.value };
  });

  // 8f. Serve logo
  app.get('/logo.png', async (req, reply) => {
    try {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve: resolvePath } = await import('path');
      const logoPath = resolvePath(process.cwd(), 'node_modules/@mostajs/net/logo/octonet-logo.png');
      const logoPath2 = resolvePath(__dirname, '../logo/octonet-logo.png');
      const path = existsSync(logoPath) ? logoPath : existsSync(logoPath2) ? logoPath2 : null;
      if (path) { reply.type('image/png'); return readFileSync(path); }
      reply.status(404); return 'Logo not found';
    } catch { reply.status(404); return 'Logo not found'; }
  });

  // 8g. Project namespace routing — /:project/*
  const RESERVED_NAMES = new Set(['api','mcp','graphql','ws','events','rpc','trpc','odata','health','_admin','arrow','nats','default','logo.png']);

  // Helper: handle REST for a specific project
  async function handleProjectRest(projectName: string, collection: string, req: any, reply: any) {
    const projectInfo = pm.getProject(projectName);
    if (!projectInfo) return reply.code(404).send({ error: 'Project not found: ' + projectName });
    const projectDialect = projectInfo.dialect;
    if (!projectDialect) return reply.code(503).send({ error: 'Project not connected: ' + projectName });
    const schema = (projectInfo.schemas || []).find((s: EntitySchema) => s.collection === collection || s.name.toLowerCase() === collection.toLowerCase());
    if (!schema) return reply.code(404).send({ error: 'Collection not found: ' + collection + ' in project ' + projectName });

    const method = req.method.toUpperCase();
    const url = req.url as string;
    const parts = url.split('/').filter(Boolean);
    // Extract ID if present: /:project/api/v1/:collection/:id
    const collIdx = parts.indexOf(collection);
    const id = parts[collIdx + 1] || null;
    const body = req.body as Record<string, unknown> | undefined;

    const ormReq: OrmRequest = { entity: schema.name, op: 'findAll' };
    if (method === 'GET' && !id) { ormReq.op = 'findAll'; }
    else if (method === 'GET' && id === 'count') { ormReq.op = 'count'; }
    else if (method === 'GET' && id) { ormReq.op = 'findById'; ormReq.id = id; }
    else if (method === 'POST') { ormReq.op = 'create'; ormReq.data = body; }
    else if (method === 'PUT' && id) { ormReq.op = 'update'; ormReq.id = id; ormReq.data = body; }
    else if (method === 'DELETE' && id) { ormReq.op = 'delete'; ormReq.id = id; }

    const ctx: TransportContext = { transport: 'rest', projectName };
    try {
      const result = await ormHandler(ormReq, ctx);
      return result;
    } catch (e: unknown) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Internal error' });
    }
  }

  // Helper: handle MCP for a specific project (tools non-prefixed, scoped to project)
  async function handleProjectMcp(projectName: string, req: any, reply: any) {
    const projectInfo = pm.getProject(projectName);
    if (!projectInfo) return reply.code(404).send({ error: 'Project not found: ' + projectName });
    const projectSchemas = projectInfo.schemas || [];
    if (!projectSchemas.length) return reply.code(404).send({ error: 'No schemas for project: ' + projectName });

    // Create a dedicated MCP transport for this project (tools non-prefixed)
    const projectMcp = new McpTransport();
    projectMcp.setHandler(async (ormReq, ctx) => {
      ctx.projectName = projectName;
      return ormHandler(ormReq, ctx);
    });
    for (const s of projectSchemas) projectMcp.registerEntity(s);
    await projectMcp.start({ enabled: true, port: 0, path: '/' + projectName + '/mcp' });

    reply.type('text/event-stream');
    const rawReq = req.raw;
    const rawRes = reply.raw;
    rawRes.setHeader('Content-Type', 'text/event-stream');
    rawRes.setHeader('Cache-Control', 'no-cache');
    rawRes.setHeader('Access-Control-Allow-Origin', '*');
    rawRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, mcp-session-id');
    await projectMcp.handleRequest(rawReq, rawRes, req.body);
  }

  // Catch-all route: /:project/...
  app.all('/:project/*', async (req, reply) => {
    const project = (req.params as any).project as string;
    if (RESERVED_NAMES.has(project)) return; // Let Fastify handle normally

    const projectInfo = pm.getProject(project);
    if (!projectInfo) return reply.code(404).send({ error: 'Project not found: ' + project });

    const fullUrl = req.url as string;
    const subpath = fullUrl.substring(('/' + project).length);

    // Health: /:project/health — NetHealthResponse format for @mostajs/setup
    if (subpath === '/health') {
      const projectSchemas = Array.isArray(projectInfo.schemas) ? projectInfo.schemas : [];
      const enabledTransportNames = Object.entries(process.env)
        .filter(([k, v]) => k.startsWith('MOSTA_NET_') && k.endsWith('_ENABLED') && v === 'true')
        .map(([k]) => k.replace('MOSTA_NET_', '').replace('_ENABLED', '').toLowerCase());
      return {
        status: 'ok',
        project,
        transports: enabledTransportNames,
        entities: projectSchemas.map((s: EntitySchema) => s.name),
      };
    }

    // API: /:project/api/test-connection
    if (subpath === '/api/test-connection') {
      const projectDialect = projectInfo.dialect;
      if (!projectDialect) return { ok: false, message: 'Project not connected: ' + project };
      try {
        return { ok: true, message: 'Connected to ' + project };
      } catch (e: unknown) {
        return { ok: false, message: e instanceof Error ? e.message : 'Connection failed' };
      }
    }

    // API: /:project/api/schemas-config
    if (subpath === '/api/schemas-config') {
      const projectSchemas = Array.isArray(projectInfo.schemas) ? projectInfo.schemas : [];
      return {
        schemasJsonExists: projectSchemas.length > 0,
        schemaCount: projectSchemas.length,
        schemas: projectSchemas.map((s: EntitySchema) => ({ name: s.name, collection: s.collection })),
      };
    }

    // API: /:project/api/apply-schema
    if (subpath === '/api/apply-schema' && req.method === 'POST') {
      const projectDialect = projectInfo.dialect;
      if (!projectDialect) return { ok: false, message: 'Project not connected' };
      const projectSchemas = Array.isArray(projectInfo.schemas) ? projectInfo.schemas : [];
      try {
        await projectDialect.initSchema(projectSchemas);
        return { ok: true, message: projectSchemas.length + ' schemas applied', tables: projectSchemas.map((s: EntitySchema) => s.collection) };
      } catch (e: unknown) {
        return { ok: false, message: e instanceof Error ? e.message : 'Schema apply failed' };
      }
    }

    // REST: /:project/api/v1/:collection[/:id]
    if (subpath.startsWith('/api/v1/')) {
      const rest = subpath.replace('/api/v1/', '');
      const collection = rest.split('/')[0];
      return handleProjectRest(project, collection, req, reply);
    }

    // MCP: /:project/mcp
    if (subpath === '/mcp' || subpath.startsWith('/mcp')) {
      return handleProjectMcp(project, req, reply);
    }

    // GraphQL: /:project/graphql — forward to main graphql with project header
    if (subpath === '/graphql' || subpath.startsWith('/graphql')) {
      req.headers['x-project'] = project;
      return reply.redirect('/graphql');
    }

    // Dashboard: /:project/ — show project info
    if (subpath === '/' || subpath === '') {
      reply.type('text/html');
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${project} — OctoNet</title>
        <style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem;max-width:800px;margin:0 auto}
        h1{color:#38bdf8}a{color:#38bdf8}code{background:#1e293b;padding:.1rem .3rem;border-radius:3px;font-size:.85rem}
        .card{background:#1e293b;border-radius:8px;padding:1rem;margin:.5rem 0}pre{background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;overflow:auto}</style></head><body>
        <h1>${project}</h1>
        <p style="color:#94a3b8">${projectInfo.dialect} — ${(projectInfo.schemas||[]).length} schemas</p>
        <div class="card"><h3 style="color:#38bdf8;margin-top:0">Endpoints</h3>
        <ul style="line-height:2">${(projectInfo.schemas||[]).map((s: EntitySchema) =>
          '<li><a href="/' + project + '/api/v1/' + s.collection + '">/' + project + '/api/v1/' + s.collection + '</a> (' + s.name + ')</li>'
        ).join('')}
        <li><a href="/${project}/mcp">/${project}/mcp</a> (MCP)</li>
        </ul></div>
        <div class="card"><h3 style="color:#38bdf8;margin-top:0">Claude Desktop</h3>
        <pre>{"mcpServers":{"${project}":{"url":"${req.protocol}://${req.hostname}/${project}/mcp"}}}</pre></div>
        <p><a href="/">← Retour au dashboard</a></p>
        </body></html>`;
    }

    return reply.code(404).send({ error: 'Unknown endpoint: ' + subpath + ' for project ' + project });
  });

  // 8h. Home page — net dashboard
  app.get('/', async (req, reply) => {
    reply.type('text/html');
    // Lire les valeurs actuelles (pas celles du démarrage)
    const currentDialect = process.env.DB_DIALECT || 'unknown';
    const currentUri = process.env.SGBD_URI || '';
    const currentMaskedUri = currentUri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
    const currentSchemas = getAllSchemas();
    return getNetDashboardHtml(config.port, enabledNames, currentSchemas, currentMaskedUri, dbError, pm);
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

  // Ensure MCP Agent Simulator works even if MCP transport is not enabled
  if (!mcpTransportRef) {
    const internalMcp = new McpTransport();
    internalMcp.setHandler(ormHandler);
    internalMcp.setProjectsProvider(() =>
      pm.listProjects().map(p => ({ name: p.name, schemas: pm.getProject(p.name)?.schemas || [] }))
    );
    for (const s of schemas) internalMcp.registerEntity(s);
    mcpTransportRef = internalMcp;
  }

  console.log(`\n  \x1b[36mReady.\x1b[0m ${schemas.length} entities × ${enabledNames.length} transports = ${schemas.length * enabledNames.length} endpoints\n`);

  return {
    app,
    entityService: entityService!,
    pm,
    stop: async () => {
      await pm.disconnectAll();
      await stopAllTransports();
      await app.close();
    },
  };
}

/**
 * Register DYNAMIC REST routes using :collection parameter.
 * Supports multi-project routing:
 *   /api/v1/:col            → default project
 *   /api/v1/:project/:col   → specific project (if project exists in PM)
 *   Header X-Project        → override project for any route
 */
function registerDynamicRestRoutes(
  app: FastifyInstance,
  ormHandler: (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>,
  pm: ProjectManager,
): void {
  const prefix = '/api/v1';

  /** Resolve project + collection from params, checking if first param is a project name */
  const resolveProjectAndCollection = (params: { col: string; sub?: string }, headers: Record<string, string>): { projectName?: string; col: string } => {
    // Priority 1: Header X-Project
    const headerProject = headers['x-project'];
    if (headerProject && pm.hasProject(headerProject)) {
      return { projectName: headerProject, col: params.col };
    }

    // Priority 2: Path prefix — if params.sub exists, col is the project, sub is the collection
    if (params.sub) {
      return { projectName: params.col, col: params.sub };
    }

    // Priority 3: Check if params.col is actually a project name (for /api/v1/:project/:col pattern)
    // Only if it's NOT a known collection
    return { projectName: undefined, col: params.col };
  };

  const handle = async (ormReq: OrmRequest, reply: any, projectName?: string, req?: any) => {
    // Resolve projectName from header if not provided via path
    const resolvedProjectId = projectName || req?.headers?.['x-project'] || undefined;
    const ctx: TransportContext = { transport: 'rest', projectName: resolvedProjectId };
    const res = await ormHandler(ormReq, ctx);
    if (res.status === 'error') {
      reply.status(res.error?.code === 'ENTITY_NOT_FOUND' || res.error?.code === 'EntityNotFoundError' ? 404 :
                   res.error?.code?.startsWith('MISSING') ? 400 :
                   res.error?.code === 'UNKNOWN_ENTITY' ? 404 :
                   res.error?.code === 'DB_NOT_CONNECTED' ? 503 : 500);
    }
    return res;
  };

  /** Resolve collection name → entity name. Checks project schemas first, then global registry */
  const resolveEntity = (collection: string, projectName?: string): string | null => {
    // If projectName specified, check that project's schemas first
    if (projectName) {
      const project = pm.getProject(projectName);
      if (project) {
        const schema = project.schemas.find(s => s.collection === collection || s.name === collection);
        if (schema) return schema.name;
      }
    }
    // Fallback to global ORM registry
    try {
      const schema = getSchemaByCollection(collection);
      return schema?.name || null;
    } catch {
      return null;
    }
  };

  /**
   * If first param is a known project name, shift params:
   *   /api/v1/project-b/users     → { projectName: 'project-b', col: 'users', id: undefined }
   *   /api/v1/project-b/users/123 → { projectName: 'project-b', col: 'users', id: '123' }
   *   /api/v1/users               → { projectName: undefined, col: 'users', id: undefined }
   *   /api/v1/users/123           → { projectName: undefined, col: 'users', id: '123' }
   * Also supports X-Project header as override.
   */
  const resolveParams = (col: string, id: string | undefined, headers: Record<string, string>): { projectName?: string; col: string; id?: string } => {
    const headerProject = headers['x-project'];
    if (headerProject) return { projectName: headerProject, col, id };
    if (pm.hasProject(col)) return { projectName: col, col: id || '', id: undefined };
    return { col, id };
  };

  const parseOpts = (q: Record<string, string>) => {
    const options: any = {};
    if (q.sort) options.sort = JSON.parse(q.sort);
    if (q.limit) options.limit = parseInt(q.limit, 10);
    if (q.skip) options.skip = parseInt(q.skip, 10);
    if (q.select) options.select = q.select.split(',');
    if (q.exclude) options.exclude = q.exclude.split(',');
    const relations = (q.relations || q.include)?.split(',').filter(Boolean);
    return { options, relations: relations?.length ? relations : undefined };
  };

  const notFound = (col: string, reply: any) => {
    reply.status(404);
    return { status: 'error', error: { code: 'UNKNOWN_ENTITY', message: `Collection "${col}" not found. Upload schemas first via POST /api/upload-schemas-json` } };
  };

  // ── Multi-project create: POST /api/v1/:project/:col → create on project ──
  // Must be BEFORE specific routes like /count, /one, etc.
  // Only triggers when :col is a known project name

  app.post(`${prefix}/:col/:id`, async (req, reply) => {
    const { col, id } = req.params as { col: string; id: string };
    const r = resolveParams(col, id, req.headers as Record<string, string>);
    // If col was a project → create on that project's collection
    if (r.projectName && !r.id) {
      const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
      const res = await handle({ op: 'create', entity, data: req.body as Record<string, unknown> }, reply, r.projectName);
      if (reply.statusCode < 400) reply.status(201);
      return res;
    }
    // Otherwise col/:id POST without /addToSet|pull|increment = not supported
    reply.status(405);
    return { status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: 'POST /:col/:id requires /addToSet, /pull, or /increment' } };
  });

  // ── Specific routes BEFORE parametric /:id ──

  app.get(`${prefix}/:col/count`, async (req, reply) => {
    const { col } = req.params as { col: string };
    const entity = resolveEntity(col, (req.headers as any)['x-project']); if (!entity) return notFound(col, reply);
    const q = req.query as Record<string, string>;
    return handle({ op: 'count', entity, filter: q.filter ? JSON.parse(q.filter) : {} }, reply);
  });

  app.get(`${prefix}/:col/one`, async (req, reply) => {
    const { col } = req.params as { col: string };
    const entity = resolveEntity(col, (req.headers as any)['x-project']); if (!entity) return notFound(col, reply);
    const q = req.query as Record<string, string>;
    const { options, relations } = parseOpts(q);
    return handle({ op: 'findOne', entity, filter: q.filter ? JSON.parse(q.filter) : {}, options, relations }, reply);
  });

  app.post(`${prefix}/:col/search`, async (req, reply) => {
    const { col } = req.params as { col: string };
    const entity = resolveEntity(col, (req.headers as any)['x-project']); if (!entity) return notFound(col, reply);
    const body = req.body as Record<string, unknown>;
    return handle({ op: 'search', entity, query: body.query as string, searchFields: body.fields as string[], options: body.options as any }, reply);
  });

  app.post(`${prefix}/:col/upsert`, async (req, reply) => {
    const { col } = req.params as { col: string };
    const entity = resolveEntity(col, (req.headers as any)['x-project']); if (!entity) return notFound(col, reply);
    const { filter, data } = req.body as { filter: any; data: any };
    return handle({ op: 'upsert', entity, filter, data }, reply);
  });

  app.post(`${prefix}/:col/aggregate`, async (req, reply) => {
    const { col } = req.params as { col: string };
    const entity = resolveEntity(col, (req.headers as any)['x-project']); if (!entity) return notFound(col, reply);
    const { stages } = req.body as { stages: any[] };
    return handle({ op: 'aggregate', entity, stages }, reply);
  });

  app.put(`${prefix}/:col/bulk`, async (req, reply) => {
    const { col } = req.params as { col: string };
    const entity = resolveEntity(col, (req.headers as any)['x-project']); if (!entity) return notFound(col, reply);
    const { filter, data } = req.body as { filter: any; data: any };
    return handle({ op: 'updateMany', entity, filter, data }, reply);
  });

  app.delete(`${prefix}/:col/bulk`, async (req, reply) => {
    const { col } = req.params as { col: string };
    const entity = resolveEntity(col, (req.headers as any)['x-project']); if (!entity) return notFound(col, reply);
    const body = req.body as Record<string, unknown> | null;
    const q = req.query as Record<string, string>;
    const filter = body?.filter || (q.filter ? JSON.parse(q.filter) : {});
    return handle({ op: 'deleteMany', entity, filter }, reply);
  });

  // ── Parametric /:col/:id routes ──

  app.get(`${prefix}/:col/:id`, async (req, reply) => {
    const { col, id } = req.params as { col: string; id: string };
    const r = resolveParams(col, id, req.headers as Record<string, string>);
    // If col was a project → r.col is the collection, r.id is undefined → findAll on that project
    if (r.projectName && !r.id) {
      const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
      const q = req.query as Record<string, string>;
      const { options, relations } = parseOpts(q);
      return handle({ op: 'findAll', entity, filter: q.filter ? JSON.parse(q.filter) : {}, options, relations }, reply, r.projectName);
    }
    const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
    const q = req.query as Record<string, string>;
    const { options, relations } = parseOpts(q);
    return handle({ op: 'findById', entity, id: r.id!, options, relations }, reply, r.projectName);
  });

  app.put(`${prefix}/:col/:id`, async (req, reply) => {
    const { col, id } = req.params as { col: string; id: string };
    const r = resolveParams(col, id, req.headers as Record<string, string>);
    const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
    return handle({ op: 'update', entity, id: r.id!, data: req.body as Record<string, unknown> }, reply, r.projectName);
  });

  app.delete(`${prefix}/:col/:id`, async (req, reply) => {
    const { col, id } = req.params as { col: string; id: string };
    const r = resolveParams(col, id, req.headers as Record<string, string>);
    const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
    return handle({ op: 'delete', entity, id: r.id!, }, reply, r.projectName);
  });

  app.post(`${prefix}/:col/:id/addToSet`, async (req, reply) => {
    const { col, id } = req.params as { col: string; id: string };
    const r = resolveParams(col, id, req.headers as Record<string, string>);
    const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
    const { field, value } = req.body as { field: string; value: unknown };
    return handle({ op: 'addToSet', entity, id: r.id!, field, value }, reply, r.projectName);
  });

  app.post(`${prefix}/:col/:id/pull`, async (req, reply) => {
    const { col, id } = req.params as { col: string; id: string };
    const r = resolveParams(col, id, req.headers as Record<string, string>);
    const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
    const { field, value } = req.body as { field: string; value: unknown };
    return handle({ op: 'pull', entity, id: r.id!, field, value }, reply, r.projectName);
  });

  app.post(`${prefix}/:col/:id/increment`, async (req, reply) => {
    const { col, id } = req.params as { col: string; id: string };
    const r = resolveParams(col, id, req.headers as Record<string, string>);
    const entity = resolveEntity(r.col, r.projectName); if (!entity) return notFound(r.col, reply);
    const { field, amount } = req.body as { field: string; amount: number };
    return handle({ op: 'increment', entity, id: r.id!, field, amount }, reply, r.projectName);
  });

  // ── Collection-level routes (also handles /api/v1/:project/:col via /:col/:id) ──

  app.get(`${prefix}/:col`, async (req, reply) => {
    const { col: rawCol } = req.params as { col: string };
    const h = req.headers as Record<string, string>;
    // If col is a project name, this is /api/v1/:project — list project info
    if (pm.hasProject(rawCol) && !h['x-project']) {
      const project = pm.getProject(rawCol);
      return { project: rawCol, schemas: project?.schemas.map(s => s.name), status: project?.status };
    }
    const projectName = h['x-project'] || undefined;
    const entity = resolveEntity(rawCol, (req.headers as any)['x-project']); if (!entity) return notFound(rawCol, reply);
    const q = req.query as Record<string, string>;
    const { options, relations } = parseOpts(q);
    return handle({ op: 'findAll', entity, filter: q.filter ? JSON.parse(q.filter) : {}, options, relations }, reply, projectName);
  });

  app.post(`${prefix}/:col`, async (req, reply) => {
    const { col: rawCol } = req.params as { col: string };
    const projectName = (req.headers as Record<string, string>)['x-project'] || undefined;
    const entity = resolveEntity(rawCol, (req.headers as any)['x-project']); if (!entity) return notFound(rawCol, reply);
    const res = await handle({ op: 'create', entity, data: req.body as Record<string, unknown> }, reply, projectName);
    if (reply.statusCode < 400) reply.status(201);
    return res;
  });

}

/**
 * Register REST routes directly on the main Fastify instance (legacy per-collection).
 * Kept for compatibility — used by RestTransport internally.
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

  const parseOpts = (q: Record<string, string>) => {
    const options: any = {};
    if (q.sort) options.sort = JSON.parse(q.sort);
    if (q.limit) options.limit = parseInt(q.limit, 10);
    if (q.skip) options.skip = parseInt(q.skip, 10);
    if (q.select) options.select = q.select.split(',');
    if (q.exclude) options.exclude = q.exclude.split(',');
    const relations = (q.relations || q.include)?.split(',').filter(Boolean);
    return { options, relations: relations?.length ? relations : undefined };
  };

  // ── Specific routes BEFORE parametric /:id ──

  app.get(`${prefix}/${col}/count`, async (req, reply) => {
    const q = req.query as Record<string, string>;
    return handle({ op: 'count', entity: schema.name, filter: q.filter ? JSON.parse(q.filter) : {} }, reply);
  });

  app.get(`${prefix}/${col}/one`, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { options, relations } = parseOpts(q);
    return handle({ op: 'findOne', entity: schema.name, filter: q.filter ? JSON.parse(q.filter) : {}, options, relations }, reply);
  });

  app.post(`${prefix}/${col}/search`, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    return handle({ op: 'search', entity: schema.name, query: body.query as string, searchFields: body.fields as string[], options: body.options as any }, reply);
  });

  app.post(`${prefix}/${col}/upsert`, async (req, reply) => {
    const { filter, data } = req.body as { filter: any; data: any };
    return handle({ op: 'upsert', entity: schema.name, filter, data }, reply);
  });

  app.post(`${prefix}/${col}/aggregate`, async (req, reply) => {
    const { stages } = req.body as { stages: any[] };
    return handle({ op: 'aggregate', entity: schema.name, stages }, reply);
  });

  app.put(`${prefix}/${col}/bulk`, async (req, reply) => {
    const { filter, data } = req.body as { filter: any; data: any };
    return handle({ op: 'updateMany', entity: schema.name, filter, data }, reply);
  });

  app.delete(`${prefix}/${col}/bulk`, async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    const q = req.query as Record<string, string>;
    const filter = body?.filter || (q.filter ? JSON.parse(q.filter) : {});
    return handle({ op: 'deleteMany', entity: schema.name, filter }, reply);
  });

  // ── Parametric /:id routes ──

  app.get(`${prefix}/${col}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    const { options, relations } = parseOpts(q);
    return handle({ op: 'findById', entity: schema.name, id, options, relations }, reply);
  });

  app.put(`${prefix}/${col}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    return handle({ op: 'update', entity: schema.name, id, data: req.body as Record<string, unknown> }, reply);
  });

  app.delete(`${prefix}/${col}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    return handle({ op: 'delete', entity: schema.name, id }, reply);
  });

  app.post(`${prefix}/${col}/:id/addToSet`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { field, value } = req.body as { field: string; value: unknown };
    return handle({ op: 'addToSet', entity: schema.name, id, field, value }, reply);
  });

  app.post(`${prefix}/${col}/:id/pull`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { field, value } = req.body as { field: string; value: unknown };
    return handle({ op: 'pull', entity: schema.name, id, field, value }, reply);
  });

  app.post(`${prefix}/${col}/:id/increment`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { field, amount } = req.body as { field: string; amount: number };
    return handle({ op: 'increment', entity: schema.name, id, field, amount }, reply);
  });

  // ── Collection-level routes ──

  app.get(`${prefix}/${col}`, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { options, relations } = parseOpts(q);
    return handle({ op: 'findAll', entity: schema.name, filter: q.filter ? JSON.parse(q.filter) : {}, options, relations }, reply);
  });

  app.post(`${prefix}/${col}`, async (req, reply) => {
    const res = await handle({ op: 'create', entity: schema.name, data: req.body as Record<string, unknown> }, reply);
    if (reply.statusCode < 400) reply.status(201);
    return res;
  });
}

// ============================================================
// Net Dashboard HTML
// ============================================================

function getNetDashboardHtml(port: number, transports: string[], schemas: EntitySchema[], dbUri: string, dbErr = '', pm?: ProjectManager): string {
  const dialect = process.env.DB_DIALECT || 'unknown';
  const entityList = schemas.map(s => s.name);
  const restEntities = schemas.map(s => `<li><a href="/api/v1/${s.collection}" target="_blank">/api/v1/${s.collection}</a> <span style="color:#94a3b8">(${s.name})</span></li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>OctoNet — 13 DBs × 11 Transports</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0}
    .container{max-width:1100px;margin:0 auto;padding:1rem 2rem}
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
    .nav-tabs{display:flex;gap:0;border-bottom:2px solid #334155;margin-bottom:1rem}
    .nav-tab{padding:.6rem 1.2rem;cursor:pointer;color:#94a3b8;font-size:.85rem;font-weight:600;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-2px}
    .nav-tab:hover{color:#e2e8f0}
    .nav-tab.active{color:#38bdf8;border-bottom-color:#38bdf8}
    .tab-content{display:none}
    .tab-content.active{display:block}
  </style>
</head>
<body>
<div class="container">
  <!-- Header with logo -->
  <div style="display:flex;align-items:center;gap:1rem;margin-bottom:.5rem">
    <img src="/logo.png" alt="OctoNet" style="height:64px;width:auto;border-radius:8px" onerror="this.style.display='none'"/>
    <div>
      <h1 style="margin:0">OctoNet <span style="font-size:.8rem;color:#94a3b8;font-weight:normal">@mostajs/net</span></h1>
      <div style="font-size:.8rem;color:#64748b">13 databases × 11 transports — <a href="/health">/health</a> | <a href="/graphql">GraphQL</a> | <a href="/rpc">RPC</a> | <a href="/odata/$metadata">OData</a></div>
    </div>
  </div>

  <div class="grid">
    <div class="card stat"><div class="num">${entityList.length}</div><div class="label">Entities</div></div>
    <div class="card stat"><div class="num">${transports.length}</div><div class="label">Transports</div></div>
    <div class="card stat"><div class="num">${entityList.length * transports.length}</div><div class="label">Endpoints</div></div>
  </div>

  <!-- Global project selector -->
  <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;padding:.5rem .75rem;background:#1e293b;border-radius:8px">
    <label style="font-size:.8rem;color:#94a3b8;white-space:nowrap;font-weight:600">Projet:</label>
    <select id="globalProject" onchange="onGlobalProjectChange()" style="padding:.35rem .6rem;min-width:220px;border:1px solid #334155;border-radius:4px;background:#0f172a;color:#e2e8f0;font-size:.85rem">
      <option value="">Tous les projets</option>
    </select>
    <span id="globalProjectStatus" style="font-size:.75rem;color:#64748b"></span>
  </div>

  <!-- Navigation tabs -->
  <div class="nav-tabs">
    <button class="nav-tab active" onclick="showTab('dashboard')">Dashboard</button>
    <button class="nav-tab" onclick="showTab('projects')">Projects</button>
    <button class="nav-tab" onclick="showTab('mcp')">MCP Agent</button>
    <button class="nav-tab" onclick="showTab('admin')">Admin</button>
    <button class="nav-tab" onclick="showTab('help')" style="margin-left:auto">Help</button>
  </div>

  <!-- TAB: Dashboard -->
  <div id="tab-dashboard" class="tab-content active">

  <h2>Configuration</h2>
  <div class="card">
    <table style="width:100%;font-size:.9rem">
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Dialect</td><td><b>${dialect}</b> <span class="mono">${dbUri}</span></td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Port</td><td><b>${port}</b></td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Pool</td><td>${process.env.DB_POOL_SIZE || '10'}</td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Strategy</td><td>${process.env.DB_SCHEMA_STRATEGY || 'none'}</td></tr>
      <tr><td style="color:#94a3b8;padding:.3rem 1rem .3rem 0">Show SQL</td><td>${process.env.DB_SHOW_SQL === 'true' ? '✅' : '❌'} Format: ${process.env.DB_FORMAT_SQL === 'true' ? '✅' : '❌'} Highlight: ${process.env.DB_HIGHLIGHT_SQL === 'true' ? '✅' : '❌'}</td></tr>
    </table>
    <div style="margin-top:.75rem;padding:.75rem;background:#1e293b;border-radius:6px;margin-bottom:.75rem">
      <label style="font-size:.75rem;color:#94a3b8;display:block;margin-bottom:.3rem">Changer le dialecte</label>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem">
        <select id="dialectSelect" onchange="onDialectChange()" style="padding:6px 10px;border-radius:4px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:.85rem">
          ${['sqlite','postgres','mysql','mariadb','mongodb','oracle','mssql','cockroachdb','db2','hana','hsqldb','spanner','sybase'].map(d =>
            '<option value="' + d + '"' + (d === dialect ? ' selected' : '') + '>' + d + '</option>'
          ).join('')}
        </select>
        <span id="dialectLabel" style="font-size:.75rem;color:#64748b"></span>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:.5rem;align-items:center">
        <label style="font-size:.75rem;color:#94a3b8">URI</label>
        <input id="dialectUri" value="${dbUri}" style="padding:6px 10px;border-radius:4px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:.85rem;font-family:monospace"/>
        <button class="btn" onclick="doChangeDialect()" style="background:#8b5cf6">Appliquer</button>
        <span id="dialectStatus" style="font-size:.85rem;color:#94a3b8"></span>
      </div>
      <div id="dialectHint" style="font-size:.7rem;color:#475569;margin-top:.3rem;font-family:monospace"></div>
    </div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
      <button class="btn" onclick="doReloadConfig()" style="background:#06b6d4">Recharger config</button>
      <button class="btn" onclick="doTestConn()" style="background:#3b82f6">Tester connexion</button>
      <button class="btn" onclick="doReconnect()" style="background:#8b5cf6">Reconnecter</button>
      <button class="btn" onclick="doCreateDb()" style="background:#22c55e">Créer la base</button>
      <button class="btn" onclick="doApplySchema()" style="background:#f59e0b;color:#000">Appliquer schéma</button>
      <button class="btn" onclick="doUnloadSchemas()" style="background:#f97316">Décharger schéma</button>
      <button class="btn" onclick="doTruncate()" style="background:#f59e0b;color:#000">Vider tables</button>
      <button class="btn" onclick="doDropTables()" style="background:#ef4444">Drop tables</button>
      <span id="dbStatus" style="font-size:.85rem;color:#94a3b8">${dbErr ? '❌ ' + dbErr : '✅ Connecté'}</span>
    </div>
    <div id="dbTestDetail"></div>
  </div>

  </div><!-- /tab-dashboard -->

  <!-- TAB: Projects -->
  <div id="tab-projects" class="tab-content">

  <h2>Projects <span style="font-size:.75rem;color:#64748b;font-weight:normal">— multi-database</span></h2>
  <div class="card" id="projectsSection">
    <div id="projectsTable" style="margin-bottom:.75rem">Chargement...</div>
    <details style="margin-top:.75rem" id="addProjectForm">
      <summary style="cursor:pointer;color:#38bdf8;font-size:.85rem;font-weight:600">+ Ajouter un projet</summary>
      <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:1rem;margin-top:.5rem">

        <!-- Ligne 1: Nom + Description -->
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:.5rem;margin-bottom:.5rem">
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Nom du projet <span style="color:#f87171">*</span></label>
            <input id="pName" placeholder="mon-projet" style="font-weight:600"/>
          </div>
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Description</label>
            <input id="pDesc" placeholder="Base de donnees pour mon application..."/>
          </div>
        </div>

        <!-- Ligne 2: Dialecte -->
        <div style="margin-bottom:.5rem">
          <label style="font-size:.75rem;color:#94a3b8">Dialecte <span style="color:#f87171">*</span></label>
          <div style="display:grid;grid-template-columns:1fr auto;gap:.5rem">
            <select id="pDialect" onchange="onPDialectChange()">
              <optgroup label="SQL Mainstream">
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="mariadb">MariaDB</option>
                <option value="sqlite">SQLite</option>
              </optgroup>
              <optgroup label="SQL Enterprise">
                <option value="oracle">Oracle</option>
                <option value="mssql">SQL Server</option>
                <option value="db2">IBM DB2</option>
                <option value="hana">SAP HANA</option>
                <option value="hsqldb">HSQLDB</option>
                <option value="sybase">Sybase</option>
              </optgroup>
              <optgroup label="NewSQL / Cloud">
                <option value="cockroachdb">CockroachDB</option>
                <option value="spanner">Google Cloud Spanner</option>
              </optgroup>
              <optgroup label="NoSQL">
                <option value="mongodb">MongoDB</option>
              </optgroup>
            </select>
            <span id="pDialectBadge" style="padding:.4rem .8rem;border-radius:4px;font-size:.75rem;background:#064e3b;color:#6ee7b7;align-self:center">SQL</span>
          </div>
          <div id="pDialectHint" style="font-size:.7rem;color:#64748b;margin-top:.25rem">postgresql://user:password@localhost:5432/dbname</div>
        </div>

        <!-- Ligne 3: URI -->
        <div style="margin-bottom:.5rem">
          <label style="font-size:.75rem;color:#94a3b8">URI de connexion <span style="color:#f87171">*</span></label>
          <input id="pUri" placeholder="postgresql://user:password@localhost:5432/mydb"/>
          <div style="display:flex;gap:.5rem;margin-top:.25rem">
            <button class="btn" style="font-size:.7rem;padding:.2rem .5rem;background:#334155" onclick="testProjectUri()">Tester la connexion</button>
            <button class="btn" style="font-size:.7rem;padding:.2rem .5rem;background:#2563eb" onclick="createProjectDb()">Creer la base</button>
            <span id="pUriStatus" style="font-size:.75rem;color:#94a3b8"></span>
          </div>
        </div>

        <!-- Ligne 4: Schema Strategy + Options SQL -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem;margin-bottom:.5rem">
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Schema Strategy</label>
            <select id="pStrategy">
              <option value="validate">validate — verifier sans modifier</option>
              <option value="update" selected>update — creer/modifier les tables</option>
              <option value="create">create — creer les tables (erreur si existantes)</option>
              <option value="create-drop">create-drop — supprimer puis recreer</option>
            </select>
          </div>
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Show SQL</label>
            <select id="pShowSql">
              <option value="false">Non</option>
              <option value="true">Oui — afficher les requetes</option>
            </select>
          </div>
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Format SQL</label>
            <select id="pFormatSql">
              <option value="false">Non</option>
              <option value="true">Oui — indenter les requetes</option>
            </select>
          </div>
        </div>

        <!-- Ligne 5: Pool -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:.5rem;margin-bottom:.5rem">
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Pool min</label>
            <input id="pPoolMin" type="number" value="2"/>
          </div>
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Pool max</label>
            <input id="pPoolMax" type="number" value="20"/>
          </div>
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Pool size</label>
            <input id="pPoolSize" type="number" value="10"/>
          </div>
          <div>
            <label style="font-size:.75rem;color:#94a3b8">Batch size</label>
            <input id="pBatchSize" type="number" value="100"/>
          </div>
        </div>

        <!-- Ligne 6: Schemas -->
        <div style="margin-bottom:.5rem">
          <label style="font-size:.75rem;color:#94a3b8">Schemas (EntitySchema[]) — JSON ou chemin</label>
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:.5rem">
            <input id="pSchemasPath" placeholder="./schemas/ ou coller du JSON [...]"/>
            <button class="btn" style="font-size:.7rem;padding:.3rem .6rem;background:#334155" onclick="document.getElementById('pSchemasFile').click()">Fichier JSON</button>
            <input type="file" id="pSchemasFile" accept=".json" style="display:none" onchange="loadPSchemasFile(this)"/>
            <button class="btn" style="font-size:.7rem;padding:.3rem .6rem;background:#334155" onclick="document.getElementById('pSchemasZip').click()">ZIP</button>
            <input type="file" id="pSchemasZip" accept=".zip" style="display:none" onchange="loadPSchemasZip(this)"/>
          </div>
          <textarea id="pSchemasJson" rows="3" placeholder='[{"name":"user","collection":"users","fields":{"email":{"type":"string","required":true},"name":{"type":"string"}},"relations":{},"indexes":[]}]' style="margin-top:.25rem;font-size:.75rem"></textarea>
          <div style="font-size:.7rem;color:#64748b">Collez un tableau JSON de schemas, ou chargez un fichier .json / .zip</div>
        </div>

        <!-- Boutons -->
        <div style="display:flex;gap:.5rem;margin-top:.75rem;align-items:center;border-top:1px solid #334155;padding-top:.75rem">
          <button class="btn" onclick="addProject()" style="padding:.5rem 1.5rem" id="pSubmitBtn">Ajouter le projet</button>
          <button class="btn" style="padding:.5rem 1rem;background:#334155" onclick="document.getElementById('addProjectForm').open=false">Annuler</button>
          <span id="pStatus" style="font-size:.85rem;color:#94a3b8;margin-left:.5rem"></span>
        </div>
      </div>
    </details>
  </div>

  <h2>Configuration <span style="font-size:.75rem;color:#64748b;font-weight:normal">— arbre decisonnel</span></h2>
  <div class="card">
    <div id="configTree" style="font-size:.85rem">Chargement...</div>
  </div>

  <h2>Schema systeme <span style="font-size:.75rem;color:#64748b;font-weight:normal">— vue electronique</span></h2>
  <div class="card" style="overflow:auto">
    <div id="schemaElectro" style="min-height:180px;font-family:monospace;font-size:.8rem;line-height:1.6">Chargement...</div>
  </div>

  <h2>Performance <span style="font-size:.75rem;color:#64748b;font-weight:normal">— metriques live</span></h2>
  <div class="card">
    <div id="perfPanel" style="font-size:.85rem">Chargement...</div>
  </div>

  </div><!-- /tab-projects -->

  <!-- TAB: MCP Agent -->
  <div id="tab-mcp" class="tab-content">

  <h2>MCP Agent Simulator <span style="font-size:.75rem;color:#64748b;font-weight:normal">— test tools like an AI agent</span></h2>
  <div class="card">
    <!-- MCP buttons (project comes from global selector) -->
    <div style="display:flex;gap:.5rem;margin-bottom:.75rem;align-items:center;flex-wrap:wrap">
      <button class="btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="mcpLoadTools()">Tools</button>
      <button class="btn" style="font-size:.75rem;padding:.3rem .6rem;background:#6366f1" onclick="mcpLoadPrompts()">Prompts</button>
      <button class="btn" style="font-size:.75rem;padding:.3rem .6rem;background:#334155" onclick="mcpLoadInfo()">Info</button>
      <button class="btn" style="font-size:.75rem;padding:.3rem .6rem;background:#0f766e" onclick="mcpLoadProjectTree()">Arbre projet</button>
      <span id="mcpProjectLabel" style="font-size:.75rem;color:#64748b"></span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <!-- Left: Tool selector -->
      <div>
        <div id="mcpToolList" style="max-height:400px;overflow-y:auto;font-size:.8rem">
          <span style="color:#64748b">Selectionnez un projet puis cliquez "Tools"</span>
        </div>
      </div>
      <!-- Right: Call panel -->
      <div>
        <div style="margin-bottom:.5rem">
          <label style="font-size:.75rem;color:#94a3b8">Tool selectionne</label>
          <input id="mcpSelectedTool" readonly style="font-weight:600;background:#0f172a"/>
        </div>
        <div style="margin-bottom:.5rem">
          <label style="font-size:.75rem;color:#94a3b8">Parametres (JSON)</label>
          <textarea id="mcpParams" rows="4" placeholder='{"filter":"{}","limit":10}'></textarea>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem">
          <button class="btn" onclick="mcpCallTool()" style="background:#22c55e;padding:.4rem 1rem">Executer</button>
          <span id="mcpCallStatus" style="font-size:.8rem;color:#94a3b8"></span>
        </div>
        <div style="margin-bottom:.25rem"><label style="font-size:.75rem;color:#94a3b8">Resultat</label></div>
        <pre id="mcpResult" style="max-height:300px;overflow:auto;font-size:.75rem;background:#0f172a;padding:.75rem;border-radius:6px;color:#6ee7b7">En attente...</pre>
      </div>
    </div>
    <!-- Log -->
    <details style="margin-top:.75rem">
      <summary style="cursor:pointer;color:#38bdf8;font-size:.8rem">Journal MCP (JSON-RPC)</summary>
      <pre id="mcpLog" style="max-height:200px;overflow:auto;font-size:.7rem;color:#94a3b8;margin-top:.5rem"></pre>
    </details>
  </div>

  </div><!-- /tab-mcp -->

  <!-- TAB: Admin -->
  <div id="tab-admin" class="tab-content">

  <h2>Transports</h2>
  <div class="card">
    ${['rest','graphql','ws','sse','jsonrpc','mcp','grpc','trpc','odata','nats','arrow'].map(t =>
      `<span class="tag ${transports.includes(t) ? 'tag-on' : 'tag-off'}">${t}</span>`
    ).join(' ')}
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

  </div><!-- /tab-admin -->

  <!-- TAB: Help -->
  ${getHelpTabHtml(port)}

</div>

<script>
const BASE=window.location.origin;

// ── Global project context ──
let _selectedProject='default';
let _projectsCache=[];

async function loadGlobalProjectDropdown(){
  try{
    const res=await fetch(BASE+'/api/projects');
    _projectsCache=await res.json();
    const sel=document.getElementById('globalProject');
    sel.innerHTML='<option value="">Tous les projets</option>';
    for(const p of _projectsCache){
      const icon=p.status==='connected'?'🟢':p.status==='error'?'🔴':'⚪';
      sel.innerHTML+='<option value="'+p.name+'">'+icon+' '+p.name+' ('+p.dialect+', '+p.schemasCount+' schemas)</option>';
    }
    sel.value=_selectedProject||'default';
    updateGlobalProjectStatus();
  }catch(e){}
}

function onGlobalProjectChange(){
  _selectedProject=document.getElementById('globalProject').value;
  updateGlobalProjectStatus();
  refreshActiveTab();
}

function updateGlobalProjectStatus(){
  const st=document.getElementById('globalProjectStatus');
  if(!_selectedProject){st.textContent='Contexte: tous les projets';return;}
  const p=_projectsCache.find(pr=>pr.name===_selectedProject);
  if(p){
    const icon=p.status==='connected'?'🟢':p.status==='error'?'🔴':'⚪';
    st.textContent=icon+' '+p.dialect+' — '+p.schemasCount+' schemas';
  }else{st.textContent='';}
}

function getActiveTabName(){
  const active=document.querySelector('.tab-content.active');
  return active?active.id.replace('tab-',''):'dashboard';
}

function refreshActiveTab(){
  const name=getActiveTabName();
  if(name==='dashboard')refreshDashboard();
  if(name==='projects'){loadProjects();loadConfigTree();loadSchemaElectro();loadPerf();}
  if(name==='mcp'){updateMcpProjectLabel();mcpLoadTools();}
  if(name==='admin')refreshAdminEntities();
}

function updateMcpProjectLabel(){
  const el=document.getElementById('mcpProjectLabel');
  if(el)el.textContent=_selectedProject?'Projet: '+_selectedProject:'Tous les projets';
}

// Tab navigation
function showTab(name){
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el=>el.classList.remove('active'));
  const tab=document.getElementById('tab-'+name);
  if(tab)tab.classList.add('active');
  event.target.classList.add('active');
  refreshActiveTab();
}
const SCHEMAS=${JSON.stringify(schemas.map(s => ({ name: s.name, collection: s.collection })))};

// ── Dashboard: refresh config for selected project ──
async function refreshDashboard(){
  const project=_selectedProject;
  if(!project||project==='default'){
    // Restore default config from process.env (reload page values)
    document.getElementById('dialectSelect').value='${dialect}';
    document.getElementById('dialectUri').value='${dbUri}';
    onDialectChange();
    return;
  }
  // Fetch project details for non-default
  try{
    const res=await fetch(BASE+'/api/projects');
    const projects=await res.json();
    const p=projects.find(pr=>pr.name===project);
    if(!p)return;
    document.getElementById('dialectSelect').value=p.dialect||'sqlite';
    document.getElementById('dialectUri').value=p.uri||'';
    onDialectChange();
  }catch(e){}
}

// ── Admin: refresh entities for selected project ──
function refreshAdminEntities(){
  const project=_selectedProject;
  const sel=document.getElementById('exEntity');
  if(!sel)return;
  if(!project||project==='default'){
    // Restore default entities from SCHEMAS
    sel.innerHTML='';
    for(const s of SCHEMAS){
      sel.innerHTML+='<option value="'+s.name+'">'+s.name+'</option>';
    }
    return;
  }
  const p=_projectsCache.find(pr=>pr.name===project);
  if(!p||!p.schemas)return;
  sel.innerHTML='';
  for(const s of p.schemas){
    sel.innerHTML+='<option value="'+s+'">'+s+' ('+project+')</option>';
  }
}

// ── Projects management ──
async function loadProjects(){
  try{
    const res=await fetch(BASE+'/api/projects');
    const projects=await res.json();
    const el=document.getElementById('projectsTable');
    if(!projects.length){el.innerHTML='<span style="color:#64748b">Aucun projet</span>';return;}
    const statusIcon={connected:'🟢',disconnected:'🔵',error:'🔴'};
    let html='<table style="width:100%;font-size:.85rem;border-collapse:collapse">';
    html+='<tr style="color:#94a3b8;border-bottom:1px solid #334155"><th style="text-align:left;padding:.4rem">Status</th><th style="text-align:left;padding:.4rem">Nom</th><th style="text-align:left;padding:.4rem">Dialecte</th><th style="text-align:left;padding:.4rem">Schemas</th><th style="text-align:left;padding:.4rem">Pool</th><th style="padding:.4rem">Actions</th></tr>';
    for(const p of projects){
      const icon=statusIcon[p.status]||'⚪';
      const schemas=p.schemas?.join(', ')||'-';
      const isSelected=p.name===_selectedProject;
      const rowBg=isSelected?'background:#1e3a5f;border-left:3px solid #38bdf8;':'';
      html+='<tr style="border-bottom:1px solid #1e293b;cursor:pointer;'+rowBg+'" onclick="selectProjectFromTable(&quot;'+p.name+'&quot;)">';
      html+='<td style="padding:.4rem">'+icon+'</td>';
      html+='<td style="padding:.4rem;font-weight:600">'+p.name+'</td>';
      html+='<td style="padding:.4rem;color:#94a3b8">'+p.dialect+'</td>';
      html+='<td style="padding:.4rem;font-size:.8rem">'+schemas+' <span style="color:#64748b">('+p.schemasCount+')</span></td>';
      html+='<td style="padding:.4rem;color:#94a3b8">'+p.poolMax+'</td>';
      html+='<td style="padding:.4rem;text-align:center">';
      if(p.name!=='default'){
        html+='<button class="btn" style="font-size:.7rem;padding:.2rem .5rem;background:#3b82f6" onclick="editProject(&quot;'+p.name+'&quot;)">✎</button> ';
        html+='<button class="btn" style="font-size:.7rem;padding:.2rem .5rem;background:#ef4444" onclick="deleteProject(&quot;'+p.name+'&quot;)">✕</button> ';
      }
      html+='<button class="btn" style="font-size:.7rem;padding:.2rem .5rem;background:#22c55e" onclick="testProject(&quot;'+p.name+'&quot;)">Test</button>';
      html+='</td></tr>';
      // Routing info
      if(p.name!=='default'){
        html+='<tr><td colspan="6" style="padding:.2rem .4rem .6rem 2rem;font-size:.75rem;color:#64748b;font-family:monospace">';
        html+='Path: /api/v1/'+p.name+'/{collection}  |  Header: X-Project: '+p.name;
        html+='</td></tr>';
      }
      if(p.error){
        html+='<tr><td colspan="6" style="padding:.2rem .4rem .4rem 2rem;font-size:.75rem;color:#f87171">'+p.error+'</td></tr>';
      }
    }
    html+='</table>';
    el.innerHTML=html;
  }catch(e){document.getElementById('projectsTable').innerHTML='<span style="color:#f87171">Erreur: '+e.message+'</span>';}
}
function selectProjectFromTable(name){
  _selectedProject=name;
  document.getElementById('globalProject').value=name;
  updateGlobalProjectStatus();
  loadProjects();
  loadConfigTree();
  loadSchemaElectro();
  loadPerf();
}

const P_DIALECT_INFO={
  postgres:{hint:'postgresql://user:pass@localhost:5432/dbname',port:5432,type:'SQL'},
  mysql:{hint:'mysql://user:pass@localhost:3306/dbname',port:3306,type:'SQL'},
  mariadb:{hint:'mariadb://user:pass@localhost:3306/dbname',port:3306,type:'SQL'},
  sqlite:{hint:':memory: ou ./data/mydb.db',port:null,type:'SQL'},
  mongodb:{hint:'mongodb://user:pass@localhost:27017/dbname?authSource=admin',port:27017,type:'NoSQL'},
  oracle:{hint:'oracle://user:pass@localhost:1521/XEPDB1',port:1521,type:'SQL Enterprise'},
  mssql:{hint:'mssql://sa:pass@localhost:1433/dbname',port:1433,type:'SQL Enterprise'},
  db2:{hint:'db2://user:pass@localhost:50000/SAMPLE',port:50000,type:'SQL Enterprise'},
  hana:{hint:'hana://user:pass@localhost:30015',port:30015,type:'SQL Enterprise'},
  hsqldb:{hint:'hsqldb:http://localhost:9001/xdb',port:9001,type:'SQL Enterprise'},
  sybase:{hint:'sybase://user:pass@localhost:5000/dbname',port:5000,type:'SQL Enterprise'},
  cockroachdb:{hint:'postgresql://user:pass@localhost:26257/dbname',port:26257,type:'NewSQL'},
  spanner:{hint:'spanner:projects/my-project/instances/my-instance/databases/mydb',port:null,type:'Cloud'},
};
function onPDialectChange(){
  const d=document.getElementById('pDialect').value;
  const info=P_DIALECT_INFO[d]||{hint:'',type:'SQL'};
  document.getElementById('pDialectHint').textContent=info.hint+(info.port?' — Port: '+info.port:'');
  document.getElementById('pUri').placeholder=info.hint;
  const badge=document.getElementById('pDialectBadge');
  badge.textContent=info.type;
  badge.style.background=info.type==='NoSQL'?'#312e81':info.type.includes('Enterprise')?'#7f1d1d':'#064e3b';
  badge.style.color=info.type==='NoSQL'?'#a5b4fc':info.type.includes('Enterprise')?'#fca5a5':'#6ee7b7';
}
async function testProjectUri(){
  const st=document.getElementById('pUriStatus');
  const dialect=document.getElementById('pDialect').value;
  const uri=document.getElementById('pUri').value.trim();
  if(!uri){st.textContent='URI requise';st.style.color='#f87171';return;}
  st.textContent='Test...';st.style.color='#94a3b8';
  try{
    const res=await fetch(BASE+'/api/test-connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dialect,uri})});
    const data=await res.json();
    st.textContent=data.ok?'✅ Connexion OK':'❌ '+(data.error||'Echec');
    st.style.color=data.ok?'#6ee7b7':'#f87171';
  }catch(e){st.textContent='❌ '+e.message;st.style.color='#f87171';}
}
async function createProjectDb(){
  const st=document.getElementById('pUriStatus');
  const dialect=document.getElementById('pDialect').value;
  const uri=document.getElementById('pUri').value.trim();
  if(!uri){st.textContent='URI requise';st.style.color='#f87171';return;}
  st.textContent='Creation...';st.style.color='#94a3b8';
  try{
    const res=await fetch(BASE+'/api/create-database',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dialect,uri})});
    const data=await res.json();
    if(data.ok){st.textContent='✅ Base creee avec succes';st.style.color='#6ee7b7';}
    else{st.textContent='❌ '+(data.error||'Echec creation');st.style.color='#f87171';}
  }catch(e){st.textContent='❌ '+e.message;st.style.color='#f87171';}
}
function loadPSchemasFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{document.getElementById('pSchemasJson').value=reader.result;};
  reader.readAsText(file);
}
function loadPSchemasZip(input){
  // ZIP upload — envoyer au serveur pour extraction
  const file=input.files[0];if(!file)return;
  document.getElementById('pSchemasJson').value='[ZIP chargé: '+file.name+' — sera envoyé au serveur]';
}
async function addProject(){
  const name=document.getElementById('pName').value.trim();
  const dialect=document.getElementById('pDialect').value;
  const uri=document.getElementById('pUri').value.trim();
  const desc=document.getElementById('pDesc').value.trim();
  const strategy=document.getElementById('pStrategy').value;
  const showSql=document.getElementById('pShowSql').value==='true';
  const formatSql=document.getElementById('pFormatSql').value==='true';
  const poolMin=parseInt(document.getElementById('pPoolMin').value)||2;
  const poolMax=parseInt(document.getElementById('pPoolMax').value)||20;
  const poolSize=parseInt(document.getElementById('pPoolSize').value)||10;
  const batchSize=parseInt(document.getElementById('pBatchSize').value)||100;
  const schemasRaw=document.getElementById('pSchemasJson').value.trim();
  const st=document.getElementById('pStatus');
  if(!name||!uri){st.textContent='Nom et URI requis';st.style.color='#f87171';return;}
  const isEdit=!!editingProject;
  st.textContent=isEdit?'Modification en cours...':'Ajout en cours...';st.style.color='#94a3b8';
  // Parse schemas
  let schemas=undefined;
  if(schemasRaw&&schemasRaw.startsWith('[')){
    try{schemas=JSON.parse(schemasRaw);}catch(e){st.textContent='❌ JSON schemas invalide: '+e.message;st.style.color='#f87171';return;}
  } else if(schemasRaw&&!schemasRaw.startsWith('[')){
    schemas=schemasRaw; // path string
  }
  const body={name,dialect,uri,description:desc,schemaStrategy:strategy,showSql,formatSql,pool:{min:poolMin,max:poolMax},poolSize,batchSize};
  if(schemas)body.schemas=schemas;
  try{
    const url=isEdit?BASE+'/api/projects/'+encodeURIComponent(editingProject):BASE+'/api/projects';
    const method=isEdit?'PUT':'POST';
    const res=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json();
    if(data.ok){
      st.textContent=isEdit?'✅ Projet "'+name+'" modifie':'✅ Projet "'+name+'" ajoute';st.style.color='#6ee7b7';
      loadProjects();
      // Reset form
      document.getElementById('pName').value='';document.getElementById('pDesc').value='';
      document.getElementById('pUri').value='';document.getElementById('pSchemasJson').value='';
      document.getElementById('pSchemasPath').value='';
      document.getElementById('pName').disabled=false;
      document.getElementById('pSubmitBtn').textContent='Ajouter le projet';
      editingProject=null;
    }
    else{st.textContent='❌ '+data.error;st.style.color='#f87171';}
  }catch(e){st.textContent='❌ '+e.message;st.style.color='#f87171';}
}
setTimeout(onPDialectChange,100);
let editingProject=null;
async function editProject(name){
  // Fetch project details and pre-fill the form
  try{
    const res=await fetch(BASE+'/api/projects');
    const projects=await res.json();
    const p=projects.find(pr=>pr.name===name);
    if(!p)return alert('Projet non trouve');
    // Open the form
    document.getElementById('addProjectForm').open=true;
    document.getElementById('pName').value=p.name;
    document.getElementById('pName').disabled=true;
    document.getElementById('pDialect').value=p.dialect;
    onPDialectChange();
    // We don't have the raw URI — user must re-enter or keep
    document.getElementById('pUri').placeholder='Entrez la nouvelle URI ou gardez l\\'actuelle';
    document.getElementById('pSchemasJson').value=JSON.stringify(p.schemas||[]);
    editingProject=name;
    document.getElementById('pSubmitBtn').textContent='Modifier le projet';
    document.getElementById('pStatus').textContent='Mode modification: '+name;
    document.getElementById('pStatus').style.color='#38bdf8';
  }catch(e){alert(e.message);}
}
async function deleteProject(name){
  if(!confirm('Supprimer le projet "'+name+'" ?'))return;
  try{await fetch(BASE+'/api/projects/'+name,{method:'DELETE'});loadProjects();}catch(e){alert(e.message);}
}
async function testProject(name){
  try{
    const res=await fetch(BASE+'/api/projects/'+name+'/test',{method:'POST'});
    const data=await res.json();
    alert(data.ok?'✅ Connexion OK':'❌ '+data.error);
  }catch(e){alert('❌ '+e.message);}
}
// ── Config Tree (arbre decisionnel) ──
async function loadConfigTree(){
  try{
    const res=await fetch(BASE+'/api/config-tree');
    const {tree}=await res.json();
    const el=document.getElementById('configTree');
    const project=_selectedProject;
    // If a non-default project is selected, build a project-specific tree
    if(project&&project!=='default'){
      const p=(tree.projects||[]).find(pr=>pr.name===project);
      if(p){
        const projectTree={
          database:{dialect:p.dialect||'?',uri:p.uri||'—',schemasCount:p.schemasCount||0,schemas:p.schemas||[],status:p.status||'unknown',poolMax:p.poolMax||10},
          transports:tree.transports||{},
        };
        el.innerHTML='<div style="margin-bottom:.5rem;font-size:.8rem;color:#38bdf8;font-weight:600">Projet: '+project+'</div>'+renderTree(projectTree,'projects.'+project);
        return;
      }
    }
    // Default: show global tree
    el.innerHTML=renderTree(tree,'');
  }catch(e){document.getElementById('configTree').innerHTML='<span style="color:#f87171">'+e.message+'</span>';}
}
function renderTree(obj,prefix){
  let html='<ul style="list-style:none;padding-left:'+(prefix?'1.2rem':'0')+'">';
  for(const[k,v]of Object.entries(obj)){
    const path=prefix?prefix+'.'+k:k;
    if(v&&typeof v==='object'&&!Array.isArray(v)){
      const icon=k==='database'?'💾':k==='server'?'🖥️':k==='transports'?'🔌':k==='projects'?'📁':'📂';
      html+='<li><details open><summary style="cursor:pointer;color:#38bdf8;font-weight:600">'+icon+' '+k+'</summary>'+renderTree(v,path)+'</details></li>';
    }else if(Array.isArray(v)){
      html+='<li><details><summary style="cursor:pointer;color:#38bdf8">📁 '+k+' <span style="color:#64748b">('+v.length+')</span></summary><ul style="list-style:none;padding-left:1.2rem">';
      for(const item of v){
        const icon=item.status==='connected'?'🟢':item.status==='error'?'🔴':'⚪';
        html+='<li>'+icon+' <b>'+item.name+'</b> <span style="color:#64748b">'+item.dialect+' ('+item.schemasCount+' schemas)</span></li>';
      }
      html+='</ul></details></li>';
    }else{
      const isBoolean=typeof v==='boolean'||v==='true'||v==='false';
      const display=isBoolean?(v===true||v==='true'?'🟢':'⚪'):String(v||'—');
      const color=v?'#e2e8f0':'#64748b';
      html+='<li style="padding:.15rem 0"><span style="color:#94a3b8">'+k+'</span>: ';
      html+='<span id="cv_'+path+'" style="color:'+color+';cursor:pointer;border-bottom:1px dashed #334155;padding:0 .2rem" ';
      html+='onclick="editConfigValue(&quot;'+path+'&quot;,&quot;'+String(v||'')+'&quot;)" title="Cliquer pour modifier">'+display+'</span></li>';
    }
  }
  html+='</ul>';
  return html;
}
async function editConfigValue(key,currentVal){
  const newVal=prompt('Modifier: '+key,currentVal);
  if(newVal===null||newVal===currentVal)return;
  try{
    const res=await fetch(BASE+'/api/config-tree',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,value:newVal})});
    const data=await res.json();
    if(data.ok){loadConfigTree();}
    else{alert('❌ '+data.error);}
  }catch(e){alert('❌ '+e.message);}
}

// ── Schema electronique ──
async function loadSchemaElectro(){
  try{
    const res=await fetch(BASE+'/api/config-tree');
    const {tree}=await res.json();
    const el=document.getElementById('schemaElectro');
    const db=tree.database||{};
    const transports=tree.transports||{};
    const projects=tree.projects||[];
    const activeT=Object.entries(transports).filter(([,v])=>v).map(([k])=>k);
    const inactiveT=Object.entries(transports).filter(([,v])=>!v).map(([k])=>k);

    // Build ASCII/HTML schema
    let html='<div style="display:flex;gap:2rem;align-items:flex-start;flex-wrap:wrap">';

    // Left: Projects/DBs
    html+='<div style="border:1px solid #334155;border-radius:8px;padding:.75rem;min-width:200px">';
    html+='<div style="color:#38bdf8;font-weight:600;margin-bottom:.5rem">💾 Databases</div>';
    for(const p of projects){
      const icon=p.status==='connected'?'🟢':p.status==='error'?'🔴':'🔵';
      html+='<div style="padding:.2rem 0">'+icon+' <b>'+p.name+'</b> <span style="color:#64748b;font-size:.75rem">'+p.dialect+'</span></div>';
      if(p.schemasCount>0)html+='<div style="padding-left:1.2rem;font-size:.7rem;color:#64748b">'+p.schemas.slice(0,5).join(', ')+(p.schemasCount>5?' +'+String(p.schemasCount-5):' ')+'</div>';
    }
    html+='</div>';

    // Center: ORM Core
    html+='<div style="display:flex;flex-direction:column;align-items:center;gap:.3rem">';
    html+='<div style="font-size:1.5rem">⟵</div>';
    html+='<div style="border:2px solid #38bdf8;border-radius:8px;padding:.75rem;text-align:center;min-width:140px">';
    html+='<div style="color:#38bdf8;font-weight:700;font-size:1rem">OctoORM</div>';
    html+='<div style="font-size:.7rem;color:#94a3b8">'+db.dialect+' | '+projects.length+' projet(s)</div>';
    html+='<div style="margin-top:.3rem;font-size:.65rem">';
    html+='<span style="background:#064e3b;color:#6ee7b7;padding:.1rem .3rem;border-radius:3px;margin:.1rem">Auth</span> ';
    html+='<span style="background:#064e3b;color:#6ee7b7;padding:.1rem .3rem;border-radius:3px;margin:.1rem">RBAC</span> ';
    html+='<span style="background:#064e3b;color:#6ee7b7;padding:.1rem .3rem;border-radius:3px;margin:.1rem">Audit</span>';
    html+='</div></div>';
    html+='<div style="font-size:1.5rem">⟶</div>';
    html+='</div>';

    // Right: Transports
    html+='<div style="border:1px solid #334155;border-radius:8px;padding:.75rem;min-width:180px">';
    html+='<div style="color:#38bdf8;font-weight:600;margin-bottom:.5rem">🔌 Transports</div>';
    for(const t of activeT){
      html+='<div style="padding:.15rem 0">🟢 <b>'+t.toUpperCase()+'</b> <span style="color:#64748b;font-size:.75rem">actif</span></div>';
    }
    for(const t of inactiveT){
      html+='<div style="padding:.15rem 0">⚪ <span style="color:#64748b">'+t.toUpperCase()+'</span></div>';
    }
    html+='</div>';

    html+='</div>';
    el.innerHTML=html;
  }catch(e){document.getElementById('schemaElectro').innerHTML='<span style="color:#f87171">'+e.message+'</span>';}
}

// ── Performance panel (live refresh) ──
async function loadPerf(){
  try{
    const res=await fetch(BASE+'/api/performance');
    const d=await res.json();
    const el=document.getElementById('perfPanel');
    const upH=Math.floor(d.uptime/3600);
    const upM=Math.floor((d.uptime%3600)/60);
    const upS=d.uptime%60;

    let html='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.75rem;margin-bottom:.75rem">';
    html+='<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:#38bdf8">'+d.requestsPerSecond+'</div><div style="font-size:.7rem;color:#94a3b8">req/s</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:#22c55e">'+d.p50+'<span style="font-size:.8rem">ms</span></div><div style="font-size:.7rem;color:#94a3b8">P50 latence</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:'+(d.p99>100?'#f59e0b':'#22c55e')+'">'+d.p99+'<span style="font-size:.8rem">ms</span></div><div style="font-size:.7rem;color:#94a3b8">P99 latence</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:#e2e8f0">'+d.totalRequests+'</div><div style="font-size:.7rem;color:#94a3b8">total requetes</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:'+(d.totalErrors>0?'#ef4444':'#22c55e')+'">'+d.totalErrors+'</div><div style="font-size:.7rem;color:#94a3b8">erreurs</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:#94a3b8">'+upH+'h'+upM+'m'+upS+'s</div><div style="font-size:.7rem;color:#94a3b8">uptime</div></div>';
    html+='</div>';

    // Rate limiting
    html+='<div style="display:flex;gap:1rem;font-size:.8rem;color:#94a3b8;margin-bottom:.5rem">';
    html+='<span>Rate limit: '+d.rateLimiting.perClient+' req/min/client</span>';
    html+='<span>Rejetes: <span style="color:'+(d.rateLimiting.rejected>0?'#f59e0b':'#6ee7b7')+'">'+d.rateLimiting.rejected+'</span></span>';
    html+='</div>';

    // Pool
    const pool=d.pool||{};
    html+='<div style="font-size:.8rem;color:#94a3b8">Pool: '+pool.total+'/'+pool.budget+' connexions';
    if(pool.perProject){
      const entries=Object.entries(pool.perProject);
      if(entries.length>0){
        html+=' — ';
        html+=entries.map(([n,p])=>n+':'+p.max).join(', ');
      }
    }
    html+='</div>';

    // Per-project metrics
    if(d.perProject&&Object.keys(d.perProject).length>0){
      html+='<div style="margin-top:.5rem;font-size:.8rem">';
      html+='<div style="color:#94a3b8;margin-bottom:.3rem">Par projet:</div>';
      for(const[name,s]of Object.entries(d.perProject)){
        html+='<div style="padding:.1rem 0">'+name+': <span style="color:#38bdf8">'+s.requests+' req</span> P50:'+s.p50+'ms P99:'+s.p99+'ms'+(s.errors>0?' <span style="color:#ef4444">'+s.errors+' err</span>':'')+'</div>';
      }
      html+='</div>';
    }

    el.innerHTML=html;
  }catch(e){document.getElementById('perfPanel').innerHTML='<span style="color:#f87171">'+e.message+'</span>';}
}

// ── MCP Agent Simulator ──
let mcpLog=[];
function mcpAddLog(dir,data){
  const ts=new Date().toLocaleTimeString();
  mcpLog.unshift({ts,dir,data});
  if(mcpLog.length>50)mcpLog.pop();
  const el=document.getElementById('mcpLog');
  if(el)el.textContent=mcpLog.map(l=>l.ts+' '+l.dir+' '+JSON.stringify(l.data)).join('\\n');
}
async function mcpLoadInfo(){
  try{
    const res=await fetch(BASE+'/api/mcp-agent/info');
    const data=await res.json();
    mcpAddLog('←',data);
    document.getElementById('mcpResult').textContent=JSON.stringify(data,null,2);
    document.getElementById('mcpResult').style.color='#38bdf8';
  }catch(e){document.getElementById('mcpResult').textContent='Error: '+e.message;}
}
async function mcpLoadTools(){
  try{
    const res=await fetch(BASE+'/api/mcp-agent/tools');
    let tools=await res.json();
    const selectedProject=_selectedProject;
    // Filter by project
    if(selectedProject){
      tools=tools.filter(t=>{
        // Tools for a project start with "projectName_"
        if(selectedProject==='default')return !t.name.includes('_'+t.entity+'_')||t.name.startsWith(t.entity+'_');
        return t.name.startsWith(selectedProject+'_');
      });
    }
    mcpAddLog('←',{tools:tools.length,project:selectedProject||'all'});
    const el=document.getElementById('mcpToolList');
    if(!tools.length){el.innerHTML='<span style="color:#64748b">Aucun tool'+(selectedProject?' pour "'+selectedProject+'"':'')+'</span>';return;}
    // Group by entity
    const groups={};
    for(const t of tools){
      const key=t.entity||'other';
      if(!groups[key])groups[key]=[];
      groups[key].push(t);
    }
    let html='';
    for(const[entity,entityTools]of Object.entries(groups)){
      html+='<details><summary style="cursor:pointer;color:#38bdf8;font-weight:600;padding:.2rem 0">'+entity+' <span style="color:#64748b;font-weight:normal">('+entityTools.length+')</span></summary>';
      html+='<div style="padding-left:.75rem">';
      for(const t of entityTools){
        const opColor=t.operation==='create'?'#22c55e':t.operation==='delete'||t.operation==='deleteMany'?'#ef4444':t.operation==='update'||t.operation==='updateMany'?'#f59e0b':'#38bdf8';
        html+='<div style="padding:.15rem 0;cursor:pointer;border-bottom:1px solid #1e293b" onclick="mcpSelectTool(&quot;'+t.name+'&quot;,&quot;'+t.operation+'&quot;,&quot;'+t.entity+'&quot;,&quot;'+(t.fields||'')+'&quot;)">';
        html+='<span style="color:'+opColor+';font-weight:600;font-size:.75rem">'+t.operation+'</span>';
        if(t.name.includes('_'+t.entity))html+=' <span style="color:#64748b;font-size:.7rem">'+t.name.split(t.entity+'_')[0]+'</span>';
        html+='</div>';
      }
      html+='</div></details>';
    }
    el.innerHTML=html;
  }catch(e){document.getElementById('mcpToolList').innerHTML='<span style="color:#f87171">'+e.message+'</span>';}
}
async function mcpLoadPrompts(){
  try{
    const res=await fetch(BASE+'/api/mcp-agent/prompts');
    const prompts=await res.json();
    mcpAddLog('←',{prompts:prompts.length});
    const el=document.getElementById('mcpToolList');
    let html='<div style="font-weight:600;color:#6366f1;margin-bottom:.5rem">Prompts MCP</div>';
    for(const p of prompts){
      html+='<div style="padding:.3rem 0;cursor:pointer;border-bottom:1px solid #1e293b" onclick="mcpSelectPrompt(&quot;'+p.name+'&quot;)">';
      html+='<span style="color:#a78bfa;font-weight:600">'+p.name+'</span>';
      html+='<div style="color:#64748b;font-size:.7rem">'+p.description+'</div>';
      if(p.args)html+='<div style="color:#94a3b8;font-size:.7rem">Args: '+p.args.join(', ')+'</div>';
      html+='</div>';
    }
    el.innerHTML=html;
  }catch(e){document.getElementById('mcpToolList').innerHTML='<span style="color:#f87171">'+e.message+'</span>';}
}
function mcpSelectTool(name,op,entity,fields){
  document.getElementById('mcpSelectedTool').value=name;
  // Pre-fill params based on operation
  const templates={
    findAll:'{"filter":"{}","limit":10}',
    findById:'{"id":""}',
    create:'{"data":"{\\"'+fields.split(', ')[0]+'\\": \\"value\\"}"}',
    update:'{"id":"","data":"{}"}',
    delete:'{"id":""}',
    count:'{"filter":"{}"}',
    findOne:'{"filter":"{}"}',
    search:'{"query":"","limit":10}',
    upsert:'{"filter":"{}","data":"{}"}',
    deleteMany:'{"filter":"{}"}',
    updateMany:'{"filter":"{}","data":"{}"}',
    aggregate:'{"stages":"[]"}',
    addToSet:'{"id":"","field":"","value":"\\"\\""}',
    pull:'{"id":"","field":"","value":"\\"\\""}',
    increment:'{"id":"","field":"","amount":1}',
  };
  document.getElementById('mcpParams').value=templates[op]||'{}';
  document.getElementById('mcpResult').textContent='Pret — cliquez Executer';
  document.getElementById('mcpResult').style.color='#94a3b8';
}
function mcpSelectPrompt(name){
  document.getElementById('mcpSelectedTool').value='prompt:'+name;
  const args={
    'describe-schema':'{}',
    'suggest-query':'{"entity":"","goal":""}',
    'explain-data':'{"entity":"","data":"{}"}',
    'list-entities':'{}',
  };
  document.getElementById('mcpParams').value=args[name]||'{}';
  document.getElementById('mcpResult').textContent='Prompt pret — cliquez Executer';
  document.getElementById('mcpResult').style.color='#a78bfa';
}
async function mcpLoadProjectTree(){
  const selectedProject=_selectedProject;
  if(!selectedProject){
    document.getElementById('mcpToolList').innerHTML='<span style="color:#f87171">Selectionnez un projet d\\'abord</span>';
    return;
  }
  try{
    const [projRes,confRes]=await Promise.all([fetch(BASE+'/api/projects'),fetch(BASE+'/api/config-tree')]);
    const projects=await projRes.json();
    const {tree}=await confRes.json();
    const p=projects.find(pr=>pr.name===selectedProject);
    if(!p){document.getElementById('mcpToolList').innerHTML='<span style="color:#f87171">Projet non trouve</span>';return;}
    const el=document.getElementById('mcpToolList');
    let html='<div style="font-weight:600;color:#0f766e;margin-bottom:.5rem">Arbre: '+p.name+'</div>';
    html+='<ul style="list-style:none;padding:0;font-size:.8rem">';
    html+='<li><details open><summary style="color:#38bdf8;cursor:pointer">💾 Database</summary><ul style="list-style:none;padding-left:1rem">';
    html+='<li>dialect: <b>'+p.dialect+'</b></li>';
    html+='<li>status: '+(p.status==='connected'?'🟢':'🔴')+' '+p.status+'</li>';
    html+='<li>schemas: <b>'+p.schemasCount+'</b></li>';
    html+='<li>pool max: '+p.poolMax+'</li>';
    if(p.error)html+='<li style="color:#f87171">error: '+p.error+'</li>';
    html+='</ul></details></li>';
    html+='<li><details open><summary style="color:#38bdf8;cursor:pointer">📋 Schemas ('+p.schemasCount+')</summary><ul style="list-style:none;padding-left:1rem">';
    for(const s of (p.schemas||[]))html+='<li>• '+s+'</li>';
    html+='</ul></details></li>';
    html+='<li><details><summary style="color:#38bdf8;cursor:pointer">🔌 Transports</summary><ul style="list-style:none;padding-left:1rem">';
    const transports=tree.transports||{};
    for(const[t,v]of Object.entries(transports))html+='<li>'+(v?'🟢':'⚪')+' '+t.toUpperCase()+'</li>';
    html+='</ul></details></li>';
    html+='<li><details><summary style="color:#94a3b8;cursor:pointer">📡 Replicas <span style="color:#64748b">(Phase 3)</span></summary><ul style="list-style:none;padding-left:1rem">';
    html+='<li style="color:#64748b">Pas de replicas configures</li>';
    html+='<li style="color:#64748b">→ @mostajs/replicator (a venir)</li>';
    html+='</ul></details></li>';
    html+='<li><details><summary style="color:#94a3b8;cursor:pointer">🔗 NET Cascade <span style="color:#64748b">(Phase 5)</span></summary><ul style="list-style:none;padding-left:1rem">';
    html+='<li style="color:#64748b">Pas de forward configure</li>';
    html+='</ul></details></li>';
    html+='</ul>';
    // Routing info
    if(p.name!=='default'){
      html+='<div style="margin-top:.75rem;padding:.5rem;background:#1e293b;border-radius:6px;font-size:.75rem">';
      html+='<div style="color:#94a3b8;margin-bottom:.25rem">Endpoints pour ce projet:</div>';
      html+='<div style="font-family:monospace;color:#6ee7b7">GET /api/v1/'+p.name+'/{collection}</div>';
      html+='<div style="font-family:monospace;color:#6ee7b7">Header: X-Project: '+p.name+'</div>';
      html+='<div style="font-family:monospace;color:#a78bfa;margin-top:.25rem">MCP tools: '+p.name+'_{entity}_{op}</div>';
      html+='</div>';
    }
    el.innerHTML=html;
  }catch(e){document.getElementById('mcpToolList').innerHTML='<span style="color:#f87171">'+e.message+'</span>';}
}
async function mcpCallTool(){
  const tool=document.getElementById('mcpSelectedTool').value;
  const paramsRaw=document.getElementById('mcpParams').value.trim();
  const st=document.getElementById('mcpCallStatus');
  const result=document.getElementById('mcpResult');
  if(!tool){st.textContent='Selectionnez un tool';st.style.color='#f87171';return;}
  let params={};
  try{params=JSON.parse(paramsRaw||'{}');}catch(e){st.textContent='JSON invalide';st.style.color='#f87171';return;}
  st.textContent='Execution...';st.style.color='#94a3b8';
  result.textContent='...';result.style.color='#94a3b8';
  mcpAddLog('→',{tool,params});
  const start=Date.now();
  try{
    const res=await fetch(BASE+'/api/mcp-agent/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,params})});
    const data=await res.json();
    const ms=Date.now()-start;
    mcpAddLog('←',data);
    if(data.status==='error'){
      result.textContent=JSON.stringify(data,null,2);
      result.style.color='#f87171';
      st.textContent='Erreur ('+ms+'ms)';st.style.color='#f87171';
    }else{
      result.textContent=JSON.stringify(data,null,2);
      result.style.color='#6ee7b7';
      st.textContent='OK ('+ms+'ms)';st.style.color='#6ee7b7';
    }
  }catch(e){
    result.textContent='Fetch error: '+e.message;result.style.color='#f87171';
    st.textContent='Erreur';st.style.color='#f87171';
  }
}

// Load all on page load
setTimeout(loadGlobalProjectDropdown,100);
setTimeout(loadProjects,200);
setTimeout(loadConfigTree,300);
setTimeout(loadSchemaElectro,400);
setTimeout(loadPerf,500);
// Auto-refresh performance every 5s
setInterval(loadPerf,5000);

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
  // Project-aware REST prefix
  const projectPrefix=(_selectedProject&&_selectedProject!=='default')?_selectedProject+'/':'';

  try{
    if(transport==='rest'){
      switch(op){
        case 'findAll':url=BASE+'/api/v1/'+projectPrefix+col;break;
        case 'findById':url=BASE+'/api/v1/'+projectPrefix+col+'/'+id;break;
        case 'count':url=BASE+'/api/v1/'+projectPrefix+col+'/count';break;
        case 'create':url=BASE+'/api/v1/'+projectPrefix+col;method='POST';reqBody=body||'{}';break;
        case 'update':url=BASE+'/api/v1/'+projectPrefix+col+'/'+id;method='PUT';reqBody=body||'{}';break;
        case 'delete':url=BASE+'/api/v1/'+projectPrefix+col+'/'+id;method='DELETE';break;
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
async function doReloadConfig(){
  const el=document.getElementById('dbStatus');
  el.textContent='Rechargement config...';
  try{
    const r=await fetch(BASE+'/api/reload-config',{method:'POST'});
    const d=await r.json();
    if(d.ok){
      el.innerHTML='<span style="color:#22c55e">✅ '+d.message+'</span>';
      setTimeout(()=>location.reload(),1500);
    }else{
      el.innerHTML='<span style="color:#ef4444">❌ '+(d.error||'Erreur')+'</span>';
    }
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
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
    if(d.ok){
      el.innerHTML='<span style="color:#22c55e">✅ '+d.message+'</span>';
      // Afficher tables + schemas
      let html='<div style="margin-top:.75rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem">';
      // Tables en DB
      html+='<div><div style="font-weight:600;font-size:.8rem;color:#94a3b8;margin-bottom:.3rem">Tables en base ('+d.tables.length+')</div>';
      if(d.tables.length>0){
        html+='<div style="display:flex;flex-wrap:wrap;gap:.3rem">';
        for(const t of d.tables){
          const isSchema=d.schemas.some(s=>s.collection===t);
          html+='<span style="font-size:.75rem;padding:2px 6px;border-radius:3px;background:'+(isSchema?'#166534':'#1e293b')+';color:'+(isSchema?'#4ade80':'#94a3b8')+'">'+t+'</span>';
        }
        html+='</div>';
      }else{
        html+='<span style="font-size:.8rem;color:#64748b">Aucune table</span>';
      }
      html+='</div>';
      // Schemas enregistrés
      html+='<div><div style="font-weight:600;font-size:.8rem;color:#94a3b8;margin-bottom:.3rem">Schemas enregistrés ('+d.schemas.length+')</div>';
      if(d.schemas.length>0){
        html+='<div style="display:flex;flex-wrap:wrap;gap:.3rem">';
        for(const s of d.schemas){
          const inDb=d.tables.includes(s.collection);
          html+='<span style="font-size:.75rem;padding:2px 6px;border-radius:3px;background:'+(inDb?'#1e3a5f':'#2d1b00')+';color:'+(inDb?'#60a5fa':'#fbbf24')+'" title="'+s.collection+' ('+s.fields+' champs, '+s.relations+' relations)">'+s.name+'</span>';
        }
        html+='</div>';
      }else{
        html+='<span style="font-size:.8rem;color:#64748b">Aucun schema</span>';
      }
      html+='</div></div>';
      // Légende
      html+='<div style="margin-top:.5rem;font-size:.7rem;color:#64748b">🟢 Table + Schema &nbsp; 🔵 Schema avec table &nbsp; 🟡 Schema sans table &nbsp; ⚪ Table hors schema</div>';
      document.getElementById('dbTestDetail').innerHTML=html;
    }else{
      el.innerHTML='<span style="color:#ef4444">❌ '+d.message+'</span>';
      document.getElementById('dbTestDetail').innerHTML='';
    }
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>';document.getElementById('dbTestDetail').innerHTML='';}
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
const DIALECT_DEFAULTS = {
  sqlite:      { uri: './data/app.db',                                          port: '',    hint: 'Chemin vers le fichier SQLite' },
  postgres:    { uri: 'postgresql://devuser:devpass26@localhost:5432/mydb',      port: '5432', hint: 'postgresql://user:pass@host:port/dbname' },
  mysql:       { uri: 'mysql://devuser:devpass26@localhost:3306/mydb',           port: '3306', hint: 'mysql://user:pass@host:port/dbname' },
  mariadb:     { uri: 'mariadb://devuser:devpass26@localhost:3306/mydb',         port: '3306', hint: 'mariadb://user:pass@host:port/dbname' },
  mongodb:     { uri: 'mongodb://devuser:devpass26@localhost:27017/mydb?authSource=admin', port: '27017', hint: 'mongodb://user:pass@host:port/dbname' },
  oracle:      { uri: 'oracle://devuser:devpass26@localhost:1521/XEPDB1',       port: '1521', hint: 'oracle://user:pass@host:port/SID' },
  mssql:       { uri: 'mssql://devuser:devpass26@localhost:1433/mydb',          port: '1433', hint: 'mssql://user:pass@host:port/dbname' },
  cockroachdb: { uri: 'postgresql://devuser:devpass26@localhost:26257/mydb',     port: '26257', hint: 'postgresql://user:pass@host:port/dbname' },
  db2:         { uri: 'db2://devuser:devpass26@localhost:50000/mydb',            port: '50000', hint: 'db2://user:pass@host:port/dbname' },
  hana:        { uri: 'hana://devuser:devpass26@localhost:30015',               port: '30015', hint: 'hana://user:pass@host:port' },
  hsqldb:      { uri: 'hsqldb:hsql://localhost:9001/mydb',                      port: '9001', hint: 'hsqldb:hsql://host:port/dbname (JDBC)' },
  spanner:     { uri: 'spanner://project/instance/mydb',                        port: '',    hint: 'spanner://project/instance/dbname' },
  sybase:      { uri: 'sybase://devuser:devpass26@localhost:5000/mydb',         port: '5000', hint: 'sybase://user:pass@host:port/dbname (JDBC)' },
};
function onDialectChange(){
  const sel=document.getElementById('dialectSelect');
  const uri=document.getElementById('dialectUri');
  const hint=document.getElementById('dialectHint');
  const label=document.getElementById('dialectLabel');
  const d=DIALECT_DEFAULTS[sel.value];
  if(d){
    uri.value=d.uri;
    uri.placeholder=d.hint;
    hint.textContent='Format: '+d.hint+(d.port?' — Port par défaut: '+d.port:'');
    label.textContent=sel.value==='sqlite'?'SQLite (fichier local)':sel.value==='hsqldb'||sel.value==='sybase'?'JDBC Bridge requis':'';
  }
  document.getElementById('dialectStatus').textContent='';
}
// Init hint on load
setTimeout(()=>{const s=document.getElementById('dialectSelect');if(s){const h=document.getElementById('dialectHint');const d=DIALECT_DEFAULTS[s.value];if(d&&h)h.textContent='Format: '+d.hint+(d.port?' — Port par défaut: '+d.port:'');}},100);

async function doChangeDialect(){
  const sel=document.getElementById('dialectSelect');
  const uri=document.getElementById('dialectUri');
  const el=document.getElementById('dialectStatus');
  if(!sel.value||!uri.value){el.innerHTML='<span style="color:#ef4444">Dialecte et URI requis</span>';return}

  // D'abord sauver la config sans connecter
  el.textContent='Sauvegarde config...';
  try{
    const r=await fetch(BASE+'/api/change-dialect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dialect:sel.value,uri:uri.value,connect:false})});
    const d=await r.json();
    if(!d.ok){el.innerHTML='<span style="color:#ef4444">❌ '+(d.error||'Erreur')+'</span>';return}

    el.innerHTML='<span style="color:#22c55e">✅ Config sauvée : '+sel.value+'</span>';

    // Proposer de se connecter (nécessite redémarrage)
    if(confirm('Config sauvée.\\n\\nRedémarrer le serveur pour se connecter à '+sel.value+' ?')){
      el.innerHTML='<span style="color:#f59e0b">🔄 Redémarrage du serveur en cours...</span>';
      // Demander le restart
      try{await fetch(BASE+'/api/restart',{method:'POST'})}catch{}
      // Attendre le retour du serveur
      await waitForServer(el);
    }
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
async function waitForServer(statusEl){
  statusEl.innerHTML='<span style="color:#f59e0b">⏳ En attente du redémarrage du serveur...</span>';
  let attempts=0;
  const maxAttempts=30;
  while(attempts<maxAttempts){
    await new Promise(r=>setTimeout(r,1500));
    attempts++;
    statusEl.innerHTML='<span style="color:#f59e0b">⏳ En attente... ('+attempts+'/'+maxAttempts+')</span>';
    try{
      const r=await fetch(BASE+'/health');
      if(r.ok){
        statusEl.innerHTML='<span style="color:#22c55e">✅ Serveur redémarré</span>';
        setTimeout(()=>location.reload(),1000);
        return;
      }
    }catch{}
  }
  statusEl.innerHTML='<span style="color:#ef4444">❌ Timeout — le serveur ne répond pas. Vérifiez le terminal.</span>';
}
async function doUnloadSchemas(){
  if(!confirm('Décharger les schemas de la mémoire ?\\nLe fichier schemas.json sera supprimé.\\nLes tables en base ne sont PAS supprimées.'))return;
  const el=document.getElementById('dbStatus');
  el.textContent='Déchargement...';
  try{
    const r=await fetch(BASE+'/api/unload-schemas',{method:'POST'});
    const d=await r.json();
    if(d.ok){
      el.innerHTML='<span style="color:#f59e0b">'+d.message+'</span>';
      setTimeout(()=>location.reload(),1500);
    }else{
      el.innerHTML='<span style="color:#ef4444">❌ '+(d.error||'Erreur')+'</span>';
    }
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
async function doTruncate(){
  if(!confirm('Vider toutes les tables ?\\nLes structures sont conservées, seules les données sont supprimées.'))return;
  const el=document.getElementById('dbStatus');
  el.textContent='Vidage des tables...';
  try{
    const r=await fetch(BASE+'/api/truncate-tables',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});
    const d=await r.json();
    if(d.ok){
      el.innerHTML='<span style="color:#f59e0b">⚠️ '+d.message+'</span>';
    }else{
      el.innerHTML='<span style="color:#ef4444">❌ '+(d.error||'Erreur')+'</span>';
    }
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
async function doDropTables(){
  if(!confirm('⚠️ DANGER : Cela va SUPPRIMER toutes les tables de la base de données.\\n\\nCette action est IRREVERSIBLE.\\n\\nContinuer ?'))return;
  if(!confirm('Êtes-vous VRAIMENT sûr ? Toutes les données seront perdues.'))return;
  const el=document.getElementById('dbStatus');
  el.textContent='Suppression des tables...';
  try{
    const r=await fetch(BASE+'/api/drop-tables',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});
    const d=await r.json();
    if(d.ok){
      el.innerHTML='<span style="color:#ef4444">⚠️ '+d.message+'</span>';
    }else{
      el.innerHTML='<span style="color:#ef4444">❌ '+(d.error||'Erreur')+'</span>';
    }
  }catch(e){el.innerHTML='<span style="color:#ef4444">❌ '+e.message+'</span>'}
}
${getHelpTabScript()}
</script>
</body>
</html>`;
}
