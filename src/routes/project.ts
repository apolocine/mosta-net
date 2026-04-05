// OctoNet — Project namespace routing (/:project/*)
// Handles all per-project endpoints: REST, MCP, health, schemas, config
// Author: Dr Hamid MADANI drmdh@msn.com

import type { FastifyInstance } from 'fastify';
import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { TransportContext } from '../core/types.js';
import { McpTransport } from '../transports/mcp.transport.js';
import { randomBytes, scryptSync } from 'crypto';

/** Hash password — uses bcryptjs if available, falls back to scrypt */
async function hashPassword(plain: string): Promise<string> {
  try {
    const bcrypt = await import('bcryptjs');
    return bcrypt.default.hash(plain, 10);
  } catch {
    // Fallback: scrypt with salt, format: $scrypt$salt$hash
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(plain, salt, 64).toString('hex');
    return `$scrypt$${salt}$${hash}`;
  }
}

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

interface ProjectManager {
  getProject(name: string): any;
  updateProject(name: string, updates: any): Promise<void>;
  listProjects(): any[];
  hasProject(name: string): boolean;
}

const RESERVED_NAMES = new Set([
  'api', 'mcp', 'graphql', 'ws', 'events', 'rpc', 'trpc', 'odata',
  'health', '_admin', 'arrow', 'nats', 'default', 'logo.png',
]);

export function registerProjectRoutes(
  app: FastifyInstance,
  pm: ProjectManager,
  ormHandler: OrmHandler,
) {

  // ── REST handler for a specific project ──
  async function handleProjectRest(projectName: string, collection: string, req: any, reply: any) {
    const projectInfo = pm.getProject(projectName);
    if (!projectInfo) return reply.code(404).send({ error: 'Project not found: ' + projectName });
    const projectDialect = projectInfo.dialect;
    if (!projectDialect) return reply.code(503).send({ error: 'Project not connected: ' + projectName });
    const schema = (projectInfo.schemas || []).find((s: EntitySchema) =>
      s.collection === collection || s.name.toLowerCase() === collection.toLowerCase()
    );
    if (!schema) return reply.code(404).send({ error: 'Collection not found: ' + collection + ' in project ' + projectName });

    const method = req.method.toUpperCase();
    const url = req.url as string;
    const parts = url.split('/').filter(Boolean);
    const collIdx = parts.indexOf(collection);
    const rawId = parts[collIdx + 1] || null;
    const id = rawId ? rawId.split('?')[0] : null;
    const body = req.body as Record<string, unknown> | undefined;

    // Parse query params
    const urlObj = new URL(url, 'http://localhost');
    const query: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => { query[k] = v; });
    const filter = query.filter ? JSON.parse(query.filter) : undefined;
    const limit = query.limit ? parseInt(query.limit) : undefined;
    const skip = query.skip ? parseInt(query.skip) : undefined;
    const sort = query.sort ? JSON.parse(query.sort) : undefined;

    const ormReq: OrmRequest = { entity: schema.name, op: 'findAll' };
    if (method === 'GET' && !id) { ormReq.op = 'findAll'; if (filter) ormReq.filter = filter; if (limit || skip || sort) ormReq.options = { limit, skip, sort }; }
    else if (method === 'GET' && id === 'count') { ormReq.op = 'count'; if (filter) ormReq.filter = filter; }
    else if (method === 'GET' && id === 'one') { ormReq.op = 'findOne'; if (filter) ormReq.filter = filter; }
    else if (method === 'GET' && id === 'search') { ormReq.op = 'search'; ormReq.query = query.q || query.query || ''; if (limit) ormReq.options = { limit }; }
    else if (method === 'GET' && id) { ormReq.op = 'findById'; ormReq.id = id; }
    else if (method === 'POST') { ormReq.op = 'create'; ormReq.data = body; }
    else if (method === 'PUT' && id) { ormReq.op = 'update'; ormReq.id = id; ormReq.data = body; }
    else if (method === 'DELETE' && id) { ormReq.op = 'delete'; ormReq.id = id; }

    const ctx: TransportContext = { transport: 'rest', projectName };
    try {
      return await ormHandler(ormReq, ctx);
    } catch (e: unknown) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Internal error' });
    }
  }

  // ── MCP handler for a specific project (tools non-prefixed) ──
  async function handleProjectMcp(projectName: string, req: any, reply: any) {
    const projectInfo = pm.getProject(projectName);
    if (!projectInfo) return reply.code(404).send({ error: 'Project not found: ' + projectName });
    const projectSchemas = projectInfo.schemas || [];
    if (!projectSchemas.length) return reply.code(404).send({ error: 'No schemas for project: ' + projectName });

    const projectMcp = new McpTransport();
    projectMcp.setHandler(async (ormReq, ctx) => {
      ctx.projectName = projectName;
      return ormHandler(ormReq, ctx);
    });
    for (const s of projectSchemas) projectMcp.registerEntity(s);
    await projectMcp.start({ enabled: true, port: 0, path: '/' + projectName + '/mcp' });

    reply.type('text/event-stream');
    const rawRes = reply.raw;
    rawRes.setHeader('Content-Type', 'text/event-stream');
    rawRes.setHeader('Cache-Control', 'no-cache');
    rawRes.setHeader('Access-Control-Allow-Origin', '*');
    rawRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, mcp-session-id');
    await projectMcp.handleRequest(req.raw, rawRes, req.body);
  }

  // ── Catch-all route: /:project/* ──
  app.all('/:project/*', async (req, reply) => {
    const project = (req.params as any).project as string;
    if (RESERVED_NAMES.has(project)) return;

    const projectInfo = pm.getProject(project);
    if (!projectInfo) return reply.code(404).send({ error: 'Project not found: ' + project });

    const fullUrl = req.url as string;
    const subpath = fullUrl.substring(('/' + project).length).split('?')[0]; // strip query string for matching

    // ── Health ──
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

    // ── Test connection ──
    if (subpath === '/api/test-connection') {
      if (!projectInfo.dialect) return { ok: false, message: 'Project not connected: ' + project };
      return { ok: true, message: 'Connected to ' + project };
    }

    // ── Schemas config ──
    if (subpath === '/api/schemas-config') {
      const projectSchemas = Array.isArray(projectInfo.schemas) ? projectInfo.schemas : [];
      return {
        schemasJsonExists: projectSchemas.length > 0,
        schemaCount: projectSchemas.length,
        schemas: projectSchemas.map((s: EntitySchema) => ({ name: s.name, collection: s.collection })),
      };
    }

    // ── Step 1: Upload schemas (save file ONLY — no DB connection, no pm.updateProject) ──
    if ((subpath === '/api/upload-schemas' || subpath === '/api/upload-schemas-json') && req.method === 'POST') {
      const body = req.body as { schemas?: any[] };
      if (!body?.schemas?.length) return { ok: false, error: 'No schemas provided' };
      try {
        const fs = await import('fs');
        if (!fs.existsSync('schemas')) fs.mkdirSync('schemas', { recursive: true });
        const fileName = 'schemas/' + project + '.json';
        fs.writeFileSync(fileName, JSON.stringify(body.schemas, null, 2));
        console.log(`  [${project}] Step 1/3: ${body.schemas.length} schemas saved to ${fileName} (file only, no DB)`);
        return { ok: true, step: 1, count: body.schemas.length, file: fileName, schemas: body.schemas.map((s: any) => s.name) };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'Upload failed' };
      }
    }

    // ── Step 2: Apply schema (load schemas from file, update project, create tables) ──
    if (subpath === '/api/apply-schema' && req.method === 'POST') {
      try {
        const fs = await import('fs');
        const schemaFile = 'schemas/' + project + '.json';

        // Load schemas from file if not in memory
        let projectCtx = pm.getProject(project);
        let projectSchemas = Array.isArray(projectCtx?.schemas) ? projectCtx!.schemas : [];
        if (!projectSchemas.length && fs.existsSync(schemaFile)) {
          const fileSchemas = JSON.parse(fs.readFileSync(schemaFile, 'utf-8'));
          await pm.updateProject(project, { schemas: fileSchemas });
          projectCtx = pm.getProject(project);
          projectSchemas = Array.isArray(projectCtx?.schemas) ? projectCtx!.schemas : [];
        }
        if (!projectSchemas.length) {
          return { ok: false, error: 'No schemas found. Upload schemas first (Step 1).' };
        }

        const projectDialect = projectCtx?.dialect;
        if (!projectDialect) {
          // DB might not exist yet
          return { ok: false, error: 'Database not connected. Create the database first.', needsCreateDb: true };
        }

        await projectDialect.initSchema(projectSchemas);
        const tables = projectSchemas.map((s: EntitySchema) => s.collection);
        console.log(`  [${project}] Step 2/3: ${tables.length} tables applied`);
        return { ok: true, step: 2, message: tables.length + ' tables created/updated', tables };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Schema apply failed';
        // Detect "database does not exist" error
        if (msg.includes('does not exist') || msg.includes('n\'existe pas')) {
          return { ok: false, error: 'Database "' + project + '" does not exist. Create it first.', needsCreateDb: true };
        }
        return { ok: false, error: msg };
      }
    }

    // ── Step 3: Save config (persist to projects-tree.json) ──
    if (subpath === '/api/save-config' && req.method === 'POST') {
      try {
        const fs = await import('fs');
        const { resolve: resolvePath } = await import('path');
        const treePath = resolvePath(process.cwd(), process.env.MOSTA_PROJECTS || 'projects-tree.json');
        const tree = fs.existsSync(treePath) ? JSON.parse(fs.readFileSync(treePath, 'utf-8')) : {};
        const schemaFile = 'schemas/' + project + '.json';
        if (!tree[project]) tree[project] = {};
        const ctx = pm.getProject(project);
        if (ctx) {
          tree[project].dialect = ctx.dialectType || tree[project].dialect;
          tree[project].schemas = fs.existsSync(schemaFile) ? schemaFile : tree[project].schemas;
          tree[project].pool = tree[project].pool || { min: ctx.pool.min, max: ctx.pool.max };
          tree[project].schemaStrategy = tree[project].schemaStrategy || 'update';
        }
        fs.writeFileSync(treePath, JSON.stringify(tree, null, 2));
        console.log(`  [${project}] Step 3/3: config saved to ${treePath}`);
        return { ok: true, step: 3, message: 'Config persisted', config: tree[project] };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
      }
    }

    // ── Step 4: Seed data (create initial records) ──
    if (subpath === '/api/seed' && req.method === 'POST') {
      const body = req.body as { seeds?: Array<{ collection: string; data: Record<string, unknown>[] }> } | null;
      const projectCtx = pm.getProject(project);
      if (!projectCtx?.dialect) return { ok: false, error: 'Project not connected: ' + project };
      const projectSchemas = Array.isArray(projectCtx.schemas) ? projectCtx.schemas : [];
      if (!projectSchemas.length) return { ok: false, error: 'No schemas. Apply schema first (Step 2).' };

      const seeds = body?.seeds;
      if (!seeds?.length) return { ok: false, error: 'No seeds provided. Send { seeds: [{ collection: "users", data: [...] }] }' };

      const results: Array<{ collection: string; created: number; error?: string }> = [];
      for (const seed of seeds) {
        const schema = projectSchemas.find((s: EntitySchema) => s.collection === seed.collection || s.name.toLowerCase() === seed.collection.toLowerCase());
        if (!schema) { results.push({ collection: seed.collection, created: 0, error: 'Collection not found' }); continue; }
        let created = 0;
        for (const record of seed.data) {
          try {
            // Hash password fields before insertion
            const data = { ...record };
            if (typeof data.password === 'string' && data.password.length < 128 && !data.password.startsWith('$')) {
              data.password = await hashPassword(data.password);
            }
            const ctx: TransportContext = { transport: 'seed', projectName: project };
            await ormHandler({ entity: schema.name, op: 'create', data }, ctx);
            created++;
          } catch (e: unknown) {
            results.push({ collection: seed.collection, created, error: e instanceof Error ? e.message : 'Seed failed' });
            break;
          }
        }
        if (!results.find(r => r.collection === seed.collection)) {
          results.push({ collection: seed.collection, created });
        }
      }
      const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
      console.log(`  [${project}] Step 4: seeded ${totalCreated} records`);
      return { ok: true, step: 4, message: totalCreated + ' records created', results };
    }

    // ── Create database ──
    if (subpath === '/api/create-database' && req.method === 'POST') {
      try {
        const fs = await import('fs');
        const { resolve: resolvePath } = await import('path');
        const treePath = resolvePath(process.cwd(), process.env.MOSTA_PROJECTS || 'projects-tree.json');
        const tree = fs.existsSync(treePath) ? JSON.parse(fs.readFileSync(treePath, 'utf-8')) : {};
        const projConf = tree[project];
        if (!projConf?.dialect || !projConf?.uri) return { ok: false, error: 'Project config missing dialect/uri in projects-tree.json' };
        const { createDatabase } = await import('@mostajs/orm');
        const dbName = projConf.uri.split('/').pop()?.split('?')[0] || project;
        await createDatabase(projConf.dialect, projConf.uri, dbName);
        return { ok: true, message: 'Database created for ' + project };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Error';
        if (msg.includes('already exists') || msg.includes('existe')) return { ok: true, message: 'Database already exists' };
        return { ok: false, error: msg };
      }
    }

    // ── REST: /:project/api/v1/:collection[/:id] ──
    if (subpath.startsWith('/api/v1/')) {
      const rest = (req.url as string).substring(('/' + project + '/api/v1/').length).split('?')[0];
      const collection = rest.split('/')[0];
      return handleProjectRest(project, collection, req, reply);
    }

    // ── MCP: /:project/mcp ──
    if (subpath === '/mcp' || subpath.startsWith('/mcp')) {
      return handleProjectMcp(project, req, reply);
    }

    // ── GraphQL: /:project/graphql ──
    if (subpath === '/graphql' || subpath.startsWith('/graphql')) {
      req.headers['x-project'] = project;
      return reply.redirect('/graphql');
    }

    // ── Project dashboard: /:project/ ──
    if (subpath === '/' || subpath === '') {
      reply.type('text/html');
      return getProjectDashboardHtml(project, projectInfo, req);
    }

    return reply.code(404).send({ error: 'Unknown endpoint: ' + subpath + ' for project ' + project });
  });
}

// ── Project dashboard HTML ──
function getProjectDashboardHtml(project: string, projectInfo: any, req: any): string {
  const schemas = Array.isArray(projectInfo.schemas) ? projectInfo.schemas : [];
  let schemasCount = schemas.length;
  // Also check if schema file exists (uploaded but not yet loaded in memory)
  try {
    const fs = require('fs');
    if (schemasCount === 0 && fs.existsSync('schemas/' + project + '.json')) {
      const fileSchemas = JSON.parse(fs.readFileSync('schemas/' + project + '.json', 'utf-8'));
      schemasCount = Array.isArray(fileSchemas) ? fileSchemas.length : 0;
    }
  } catch {}
  const protocol = req.protocol || 'https';
  const host = req.hostname || 'localhost';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${project} — OctoNet</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem;max-width:900px;margin:0 auto}
  h1{color:#38bdf8}h2{color:#94a3b8;font-size:1rem;margin-top:1.5rem}
  a{color:#38bdf8;text-decoration:none}a:hover{text-decoration:underline}
  .card{background:#1e293b;border-radius:8px;padding:1rem;margin:.5rem 0}
  .btn{padding:.4rem .8rem;border:none;border-radius:4px;cursor:pointer;font-size:.85rem;color:#fff;margin:.2rem}
  .btn:hover{opacity:.85}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  pre{background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;overflow:auto}
  code{background:#0f172a;padding:.1rem .3rem;border-radius:3px;font-size:.85rem}
  input[type=file]{display:none}
  #status{font-size:.85rem;padding:.3rem 0}
</style></head><body>
<h1>${project}</h1>
<p style="color:#94a3b8">${projectInfo.dialectType || '?'} — ${schemasCount} schemas — ${projectInfo.status === 'connected' ? '🟢 connected' : '🔴 ' + (projectInfo.status || 'unknown')}</p>

<!-- Endpoints -->
<h2>Endpoints</h2>
<div class="card">
  <ul style="line-height:2;list-style:none;padding:0;font-size:.9rem">
    ${schemas.map((s: EntitySchema) =>
      '<li><a href="/' + project + '/api/v1/' + s.collection + '">/' + project + '/api/v1/' + s.collection + '</a> <span style="color:#64748b">(' + s.name + ')</span></li>'
    ).join('')}
    <li><a href="/${project}/mcp">/${project}/mcp</a> <span style="color:#64748b">(MCP — ${schemasCount * 15} tools)</span></li>
  </ul>
</div>

<!-- Steps: Upload → Apply → Save -->
<h2>Configuration du projet</h2>
<div class="card">
  <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.75rem">
    <span style="font-size:.85rem;color:#94a3b8;font-weight:600">Etape 1:</span>
    <label class="btn" style="background:#3b82f6" id="btnUpload">
      Uploader schemas.json
      <input type="file" id="fileSchemas" accept=".json" onchange="doUploadSchemas(this)"/>
    </label>
    <span id="step1Status" style="font-size:.8rem;color:#64748b">${schemasCount > 0 ? '✅ ' + schemasCount + ' schemas' : 'Aucun schema'}</span>
  </div>

  <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.75rem">
    <span style="font-size:.85rem;color:#94a3b8;font-weight:600">Etape 2:</span>
    <button class="btn" style="background:#f59e0b;color:#000" id="btnApply" onclick="doApplySchema()" ${schemasCount > 0 ? '' : 'disabled'}>Appliquer le schema</button>
    <span id="step2Status" style="font-size:.8rem;color:#64748b"></span>
  </div>

  <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.75rem">
    <span style="font-size:.85rem;color:#94a3b8;font-weight:600">Etape 3:</span>
    <button class="btn" style="background:#22c55e" id="btnSave" onclick="doSaveConfig()" disabled>Enregistrer la config</button>
    <span id="step3Status" style="font-size:.8rem;color:#64748b"></span>
  </div>

  <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem">
    <span style="font-size:.85rem;color:#94a3b8;font-weight:600">Etape 4:</span>
    <button class="btn" style="background:#6366f1" id="btnSeed" onclick="doSeed()" disabled>Seed (admin)</button>
    <button class="btn" style="background:#334155;font-size:.7rem" id="btnSeedCustom" onclick="document.getElementById('seedPanel').style.display='block'" disabled>Seed personnalise</button>
    <span id="step4Status" style="font-size:.8rem;color:#64748b"></span>
  </div>
  <div id="seedPanel" style="display:none;margin-top:.5rem">
    <textarea id="seedJson" rows="6" style="width:100%;font-family:monospace;font-size:.75rem;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:.5rem" placeholder='[{"collection":"users","data":[{"email":"admin@amia.fr","password":"admin123","firstName":"Admin","lastName":"System","status":"active"}]}]'></textarea>
    <button class="btn" style="background:#6366f1;margin-top:.3rem;font-size:.8rem" onclick="doSeedCustom()">Executer le seed</button>
    <span id="seedCustomStatus" style="font-size:.8rem;color:#64748b;margin-left:.5rem"></span>
  </div>
</div>

<!-- Claude Desktop -->
<h2>Claude Desktop</h2>
<div class="card">
  <pre style="color:#6ee7b7">{"mcpServers":{"${project}":{"url":"${protocol}://${host}/${project}/mcp"}}}</pre>
</div>

<p style="margin-top:1.5rem"><a href="/">← Retour au dashboard</a></p>

<script>
const BASE=window.location.origin;
const PROJECT='${project}';

async function doUploadSchemas(input){
  const file=input.files[0];if(!file)return;
  const s1=document.getElementById('step1Status');
  s1.textContent='Upload en cours...';s1.style.color='#94a3b8';
  try{
    const text=await file.text();
    const schemas=JSON.parse(text);
    const arr=Array.isArray(schemas)?schemas:[schemas];
    const res=await fetch(BASE+'/'+PROJECT+'/api/upload-schemas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemas:arr})});
    const data=await res.json();
    if(data.ok){
      s1.textContent='✅ '+data.count+' schemas uploades ('+data.file+')';s1.style.color='#6ee7b7';
      document.getElementById('btnApply').disabled=false;
    }else{s1.textContent='❌ '+data.error;s1.style.color='#f87171';}
  }catch(e){s1.textContent='❌ '+e.message;s1.style.color='#f87171';}
}

async function doApplySchema(){
  const s2=document.getElementById('step2Status');
  s2.textContent='Application...';s2.style.color='#94a3b8';
  document.getElementById('btnApply').disabled=true;
  try{
    const res=await fetch(BASE+'/'+PROJECT+'/api/apply-schema',{method:'POST'});
    const data=await res.json();
    if(data.ok){
      s2.textContent='✅ '+data.message;s2.style.color='#6ee7b7';
      document.getElementById('btnSave').disabled=false;
    }else if(data.needsCreateDb){
      // Propose to create DB
      s2.style.color='#f59e0b';
      s2.innerHTML='⚠️ '+data.error+' <button class="btn" style="font-size:.7rem;padding:.2rem .5rem;background:#22c55e;margin-left:.5rem" onclick="doCreateDbThenApply()">Creer la base</button>';
      document.getElementById('btnApply').disabled=false;
    }else{s2.textContent='❌ '+(data.error||data.message);s2.style.color='#f87171';document.getElementById('btnApply').disabled=false;}
  }catch(e){s2.textContent='❌ '+e.message;s2.style.color='#f87171';document.getElementById('btnApply').disabled=false;}
}

async function doCreateDbThenApply(){
  const s2=document.getElementById('step2Status');
  s2.textContent='Creation de la base...';s2.style.color='#94a3b8';
  try{
    const res=await fetch(BASE+'/'+PROJECT+'/api/create-database',{method:'POST'});
    const data=await res.json();
    if(data.ok){
      s2.textContent='✅ Base creee — application du schema...';s2.style.color='#6ee7b7';
      // Now apply schema
      await doApplySchema();
    }else{s2.textContent='❌ '+(data.error||'Creation echouee');s2.style.color='#f87171';}
  }catch(e){s2.textContent='❌ '+e.message;s2.style.color='#f87171';}
}

async function doSaveConfig(){
  const s3=document.getElementById('step3Status');
  s3.textContent='Enregistrement...';s3.style.color='#94a3b8';
  document.getElementById('btnSave').disabled=true;
  try{
    const res=await fetch(BASE+'/'+PROJECT+'/api/save-config',{method:'POST'});
    const data=await res.json();
    if(data.ok){
      s3.textContent='✅ '+data.message;s3.style.color='#6ee7b7';
      document.getElementById('btnSeed').disabled=false;
      document.getElementById('btnSeedCustom').disabled=false;
    }else{s3.textContent='❌ '+(data.error||data.message);s3.style.color='#f87171';document.getElementById('btnSave').disabled=false;}
  }catch(e){s3.textContent='❌ '+e.message;s3.style.color='#f87171';document.getElementById('btnSave').disabled=false;}
}

// Step 4: Seed admin user
async function doSeed(){
  const s4=document.getElementById('step4Status');
  s4.textContent='Seeding admin...';s4.style.color='#94a3b8';
  document.getElementById('btnSeed').disabled=true;
  try{
    const seeds=[
      {collection:'roles',data:[
        {name:'admin',description:'Administrateur systeme'},
        {name:'user',description:'Utilisateur standard'}
      ]},
      {collection:'users',data:[
        {email:'admin@amia.fr',password:'admin123',firstName:'Admin',lastName:'System',status:'active'}
      ]}
    ];
    const res=await fetch(BASE+'/'+PROJECT+'/api/seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seeds})});
    const data=await res.json();
    if(data.ok){
      s4.textContent='✅ '+data.message;s4.style.color='#6ee7b7';
    }else{s4.textContent='❌ '+(data.error||'Seed failed');s4.style.color='#f87171';document.getElementById('btnSeed').disabled=false;}
  }catch(e){s4.textContent='❌ '+e.message;s4.style.color='#f87171';document.getElementById('btnSeed').disabled=false;}
}

// Step 4: Custom seed
async function doSeedCustom(){
  const sc=document.getElementById('seedCustomStatus');
  const raw=document.getElementById('seedJson').value.trim();
  if(!raw){sc.textContent='JSON requis';sc.style.color='#f87171';return;}
  sc.textContent='Seeding...';sc.style.color='#94a3b8';
  try{
    const seeds=JSON.parse(raw);
    const res=await fetch(BASE+'/'+PROJECT+'/api/seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seeds:Array.isArray(seeds)?seeds:[seeds]})});
    const data=await res.json();
    if(data.ok){
      sc.textContent='✅ '+data.message;sc.style.color='#6ee7b7';
    }else{sc.textContent='❌ '+(data.error||'Seed failed');sc.style.color='#f87171';}
  }catch(e){sc.textContent='❌ '+e.message;sc.style.color='#f87171';}
}
</script>
</body></html>`;
}
