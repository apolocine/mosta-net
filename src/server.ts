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

  // 8b. Home page — net dashboard
  app.get('/', async (req, reply) => {
    reply.type('text/html');
    return getNetDashboardHtml(config.port, enabledNames, schemas, maskedUri);
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

// ============================================================
// Net Dashboard HTML
// ============================================================

function getNetDashboardHtml(port: number, transports: string[], schemas: EntitySchema[], dbUri: string): string {
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
</script>
</body>
</html>`;
}
