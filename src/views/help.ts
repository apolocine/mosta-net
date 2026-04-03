// OctoNet Dashboard — Help tab (About + How to Use)
// Author: Dr Hamid MADANI drmdh@msn.com

export function getHelpTabHtml(port: number): string {
  return `
  <div id="tab-help" class="tab-content">

  <!-- Sub-tabs -->
  <div style="display:flex;gap:0;border-bottom:1px solid #334155;margin-bottom:1rem">
    <button class="help-subtab active" onclick="showHelpSub('about')" style="padding:.4rem 1rem;cursor:pointer;color:#94a3b8;font-size:.8rem;font-weight:600;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px">A propos</button>
    <button class="help-subtab" onclick="showHelpSub('howto')" style="padding:.4rem 1rem;cursor:pointer;color:#94a3b8;font-size:.8rem;font-weight:600;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px">How to Use</button>
  </div>

  <!-- SUB: About -->
  <div id="help-about" class="help-sub active">
    <div class="card">
      <h2 style="color:#38bdf8;margin-top:0">OctoNet MCP</h2>
      <p style="font-size:.9rem;color:#94a3b8;line-height:1.6">
        <b>1 MCP server, 13 databases, zero config.</b><br/>
        OctoNet est un serveur multi-protocole qui expose vos entites de base de donnees
        via 11 transports simultanes. Les agents IA (Claude, GPT, etc.) peuvent interagir
        avec vos donnees via le protocole MCP (Model Context Protocol).
      </p>

      <h3 style="color:#e2e8f0;font-size:.95rem;margin-top:1.5rem">13 Bases de donnees</h3>
      <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin:.5rem 0">
        ${['PostgreSQL','MySQL','MariaDB','SQLite','MongoDB','Oracle','SQL Server','DB2','SAP HANA','HSQLDB','Sybase','CockroachDB','Cloud Spanner'].map(d =>
          '<span style="display:inline-block;padding:.2rem .5rem;border-radius:4px;font-size:.75rem;background:#064e3b;color:#6ee7b7">' + d + '</span>'
        ).join(' ')}
      </div>

      <h3 style="color:#e2e8f0;font-size:.95rem;margin-top:1.5rem">11 Transports</h3>
      <table style="width:100%;font-size:.8rem;border-collapse:collapse;margin:.5rem 0">
        <tr style="color:#94a3b8;border-bottom:1px solid #334155">
          <th style="text-align:left;padding:.3rem">#</th>
          <th style="text-align:left;padding:.3rem">Transport</th>
          <th style="text-align:left;padding:.3rem">Endpoint</th>
          <th style="text-align:left;padding:.3rem">Usage</th>
        </tr>
        ${[
          ['1','REST','/api/v1/{collection}','CRUD HTTP standard'],
          ['2','GraphQL','/graphql','Queries flexibles + GraphiQL IDE'],
          ['3','WebSocket','/ws','Temps reel bidirectionnel'],
          ['4','SSE','/events','Streaming serveur → client'],
          ['5','JSON-RPC','/rpc','Appels de methodes JSON-RPC 2.0'],
          ['6','MCP','/mcp','Agents IA (Claude, GPT)'],
          ['7','gRPC',':50051','Haute performance, proto auto-genere'],
          ['8','tRPC','/trpc/{Entity}.{op}','TypeScript fullstack type-safe'],
          ['9','OData','/odata/{Collection}','Filtres OData v4 ($filter, $select)'],
          ['10','NATS','mostajs.{Entity}.{op}','Pub/sub messaging'],
          ['11','Arrow Flight','/arrow/*','Streaming colonnes haute perf'],
        ].map(r => '<tr style="border-bottom:1px solid #1e293b"><td style="padding:.3rem;color:#64748b">' + r[0] + '</td><td style="padding:.3rem;font-weight:600">' + r[1] + '</td><td style="padding:.3rem;font-family:monospace;color:#6ee7b7;font-size:.75rem">' + r[2] + '</td><td style="padding:.3rem;color:#94a3b8">' + r[3] + '</td></tr>').join('')}
      </table>

      <h3 style="color:#e2e8f0;font-size:.95rem;margin-top:1.5rem">15 MCP Tools par entite</h3>
      <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin:.5rem 0">
        ${['findAll','findById','create','update','delete','count','findOne','search','upsert','deleteMany','updateMany','aggregate','addToSet','pull','increment'].map(op =>
          '<span style="display:inline-block;padding:.15rem .4rem;border-radius:3px;font-size:.7rem;font-family:monospace;background:#1e293b;color:#e2e8f0;border:1px solid #334155">' + op + '</span>'
        ).join(' ')}
      </div>

      <h3 style="color:#e2e8f0;font-size:.95rem;margin-top:1.5rem">4 Prompts MCP</h3>
      <ul style="font-size:.85rem;color:#94a3b8;padding-left:1.2rem;line-height:1.8">
        <li><b style="color:#a78bfa">describe-schema</b> — Decrire toutes les entites, champs, relations</li>
        <li><b style="color:#a78bfa">suggest-query</b> — Aider a construire un filtre</li>
        <li><b style="color:#a78bfa">explain-data</b> — Expliquer les resultats d'une requete</li>
        <li><b style="color:#a78bfa">list-entities</b> — Vue rapide des entites</li>
      </ul>

      <h3 style="color:#e2e8f0;font-size:.95rem;margin-top:1.5rem">Liens</h3>
      <ul style="font-size:.85rem;padding-left:1.2rem;line-height:1.8">
        <li><a href="https://github.com/apolocine/mosta-net" target="_blank">GitHub — @mostajs/net</a></li>
        <li><a href="https://www.npmjs.com/package/@mostajs/net" target="_blank">npm — @mostajs/net</a></li>
        <li><a href="https://smithery.ai/servers/mostajs/octonet-mcp" target="_blank">Smithery.ai</a></li>
        <li><a href="https://mcp.so/server/octonet-mcp/apolocine" target="_blank">mcp.so</a></li>
      </ul>

      <div style="margin-top:1.5rem;padding:.75rem;background:#0f172a;border-radius:6px;font-size:.8rem;color:#64748b">
        Author: Dr Hamid MADANI &lt;drmdh@msn.com&gt;<br/>
        License: AGPL-3.0-or-later
      </div>
    </div>
  </div>

  <!-- SUB: How to Use -->
  <div id="help-howto" class="help-sub" style="display:none">

    <!-- Section 1: MCP -->
    <div class="card" style="margin-bottom:1rem">
      <h2 style="color:#38bdf8;margin-top:0">1. Utiliser le endpoint MCP</h2>
      <p style="font-size:.85rem;color:#94a3b8;margin-bottom:.75rem">
        Le endpoint MCP permet aux agents IA de decouvrir et appeler les tools automatiquement.
      </p>

      <h4 style="color:#e2e8f0;font-size:.85rem">Claude Desktop — mode remote</h4>
      <p style="font-size:.8rem;color:#94a3b8">Ajouter dans <code style="background:#0f172a;padding:.1rem .3rem;border-radius:3px">claude_desktop_config.json</code> :</p>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#6ee7b7;overflow-x:auto">{
  "mcpServers": {
    "octonet": {
      "url": "https://mcp.amia.fr/mcp"
    }
  }
}</pre>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Claude Desktop — mode local (npx)</h4>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#6ee7b7;overflow-x:auto">{
  "mcpServers": {
    "octonet": {
      "command": "npx",
      "args": ["octonet-mcp", "--dialect=sqlite", "--uri=:memory:"]
    }
  }
}</pre>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Test MCP (curl)</h4>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#e2e8f0;overflow-x:auto"><span style="color:#64748b"># Initialize</span>
<span style="color:#22c55e">curl</span> -X POST https://mcp.amia.fr/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'</pre>
    </div>

    <!-- Section 2: Projects -->
    <div class="card" style="margin-bottom:1rem">
      <h2 style="color:#38bdf8;margin-top:0">2. Configurer un projet</h2>
      <p style="font-size:.85rem;color:#94a3b8;margin-bottom:.75rem">
        Chaque projet obtient son propre namespace URL. Tous les transports sont disponibles sous ce namespace.
      </p>

      <h4 style="color:#e2e8f0;font-size:.85rem">Creer un projet</h4>
      <p style="font-size:.8rem;color:#94a3b8">Via l'onglet Projects du dashboard, ou via l'API :</p>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#e2e8f0;overflow-x:auto"><span style="color:#22c55e">curl</span> -X POST https://mcp.amia.fr/api/projects \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "myapp",
    "dialect": "postgres",
    "uri": "postgresql://user:pass@localhost:5432/mydb",
    "schemas": [
      {"name":"User","collection":"users","fields":{"email":{"type":"string","required":true},"name":{"type":"string"}},"relations":{},"indexes":[]},
      {"name":"Product","collection":"products","fields":{"title":{"type":"string","required":true},"price":{"type":"number"}},"relations":{},"indexes":[]}
    ]
  }'</pre>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Endpoints du projet</h4>
      <p style="font-size:.8rem;color:#94a3b8">Une fois cree, le projet est accessible via son namespace :</p>
      <table style="width:100%;font-size:.8rem;border-collapse:collapse;margin:.5rem 0">
        <tr style="color:#94a3b8;border-bottom:1px solid #334155">
          <th style="text-align:left;padding:.3rem">Transport</th>
          <th style="text-align:left;padding:.3rem">URL</th>
        </tr>
        ${[
          ['REST','https://mcp.amia.fr/<b>myapp</b>/api/v1/users'],
          ['MCP','https://mcp.amia.fr/<b>myapp</b>/mcp'],
          ['GraphQL','https://mcp.amia.fr/<b>myapp</b>/graphql'],
          ['WebSocket','wss://mcp.amia.fr/<b>myapp</b>/ws'],
          ['JSON-RPC','https://mcp.amia.fr/<b>myapp</b>/rpc'],
          ['SSE','https://mcp.amia.fr/<b>myapp</b>/events'],
          ['tRPC','https://mcp.amia.fr/<b>myapp</b>/trpc/'],
          ['OData','https://mcp.amia.fr/<b>myapp</b>/odata/'],
        ].map(r => '<tr style="border-bottom:1px solid #1e293b"><td style="padding:.3rem;font-weight:600">' + r[0] + '</td><td style="padding:.3rem;font-family:monospace;color:#6ee7b7;font-size:.75rem">' + r[1] + '</td></tr>').join('')}
      </table>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Claude Desktop — par projet</h4>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#6ee7b7;overflow-x:auto">{
  "mcpServers": {
    "myapp": {
      "url": "https://mcp.amia.fr/myapp/mcp"
    }
  }
}</pre>
      <p style="font-size:.8rem;color:#94a3b8;margin-top:.5rem">
        Les tools MCP sont alors <b>non-prefixes</b> : <code>User_findAll</code>, <code>Product_create</code> —
        pas de collision avec d'autres projets.
      </p>
    </div>

    <!-- Section 3: NetClient -->
    <div class="card" style="margin-bottom:1rem">
      <h2 style="color:#38bdf8;margin-top:0">3. Utiliser NetClient dans une application</h2>
      <p style="font-size:.85rem;color:#94a3b8;margin-bottom:.75rem">
        <code>@mostajs/net/client</code> permet de connecter une application Next.js/Node.js a OctoNet
        en remplacement d'un acces base de donnees direct.
      </p>

      <h4 style="color:#e2e8f0;font-size:.85rem">Installation</h4>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#e2e8f0">npm install @mostajs/net @mostajs/orm</pre>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Configuration .env</h4>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#e2e8f0"><span style="color:#64748b"># Basculer en mode NET (au lieu d'ORM direct)</span>
MOSTA_DATA=net
MOSTA_NET_URL=https://mcp.amia.fr/myapp
MOSTA_NET_TRANSPORT=rest</pre>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Code — Data Access Layer</h4>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#e2e8f0;overflow-x:auto"><span style="color:#64748b">// src/dal/service.ts</span>
<span style="color:#c084fc">import</span> { NetClient, createNetDialectProxy } <span style="color:#c084fc">from</span> <span style="color:#6ee7b7">'@mostajs/net/client'</span>;
<span style="color:#c084fc">import</span> { getDialect } <span style="color:#c084fc">from</span> <span style="color:#6ee7b7">'@mostajs/orm'</span>;

<span style="color:#64748b">// Mode NET ou ORM direct ?</span>
<span style="color:#c084fc">const</span> isNet = process.env.MOSTA_DATA === <span style="color:#6ee7b7">'net'</span>;

<span style="color:#c084fc">function</span> <span style="color:#38bdf8">getDb</span>() {
  <span style="color:#c084fc">if</span> (isNet) {
    <span style="color:#c084fc">const</span> client = <span style="color:#c084fc">new</span> NetClient({
      url: process.env.MOSTA_NET_URL!,  <span style="color:#64748b">// https://mcp.amia.fr/myapp</span>
    });
    <span style="color:#c084fc">return</span> createNetDialectProxy(client);
  }
  <span style="color:#c084fc">return</span> getDialect(); <span style="color:#64748b">// ORM direct (MongoDB, Postgres, etc.)</span>
}

<span style="color:#64748b">// Repositories</span>
<span style="color:#c084fc">export const</span> userRepo  = () => getDb().getRepository(<span style="color:#6ee7b7">'User'</span>);
<span style="color:#c084fc">export const</span> prodRepo  = () => getDb().getRepository(<span style="color:#6ee7b7">'Product'</span>);
<span style="color:#c084fc">export const</span> orderRepo = () => getDb().getRepository(<span style="color:#6ee7b7">'Order'</span>);</pre>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Utilisation dans une API route</h4>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.8rem;color:#e2e8f0;overflow-x:auto"><span style="color:#64748b">// src/app/api/users/route.ts</span>
<span style="color:#c084fc">import</span> { userRepo } <span style="color:#c084fc">from</span> <span style="color:#6ee7b7">'@/dal/service'</span>;

<span style="color:#c084fc">export async function</span> <span style="color:#38bdf8">GET</span>() {
  <span style="color:#c084fc">const</span> users = <span style="color:#c084fc">await</span> userRepo().findAll();
  <span style="color:#c084fc">return</span> Response.json(users);
  <span style="color:#64748b">// En mode NET → GET https://mcp.amia.fr/myapp/api/v1/users</span>
  <span style="color:#64748b">// En mode ORM → SELECT * FROM users (direct DB)</span>
}

<span style="color:#c084fc">export async function</span> <span style="color:#38bdf8">POST</span>(req: Request) {
  <span style="color:#c084fc">const</span> data = <span style="color:#c084fc">await</span> req.json();
  <span style="color:#c084fc">const</span> user = <span style="color:#c084fc">await</span> userRepo().create(data);
  <span style="color:#c084fc">return</span> Response.json(user, { status: 201 });
}</pre>

      <h4 style="color:#e2e8f0;font-size:.85rem;margin-top:1rem">Schemas par defaut (demo)</h4>
      <p style="font-size:.8rem;color:#94a3b8">Le serveur demarre avec 3 entites de demo :</p>
      <pre style="background:#0f172a;padding:.75rem;border-radius:6px;font-size:.75rem;color:#e2e8f0;overflow-x:auto"><span style="color:#38bdf8">User</span>     { email: string*, name: string*, age: number, active: boolean }
<span style="color:#38bdf8">Product</span>  { title: string*, price: number*, stock: number, category: string }
<span style="color:#38bdf8">Order</span>    { userId: string*, total: number*, status: string, createdAt: date }</pre>
      <p style="font-size:.8rem;color:#94a3b8;margin-top:.5rem">
        Pour ajouter vos propres entites, utilisez l'onglet <b>Projects</b> ou editez <code>schemas.json</code>.
      </p>
    </div>

    <!-- Section 4: Architecture -->
    <div class="card">
      <h2 style="color:#38bdf8;margin-top:0">4. Architecture</h2>
      <pre style="background:#0f172a;padding:1rem;border-radius:6px;font-size:.75rem;color:#e2e8f0;line-height:1.6;overflow-x:auto">
<span style="color:#38bdf8">Application</span> (Next.js, PWA, Agent IA)
     |
     |  MOSTA_NET_URL=https://mcp.amia.fr/myapp
     |  MOSTA_NET_TRANSPORT=rest
     v
<span style="color:#22c55e">OctoNet NET</span>  ────────────────────────────
     |  /:project/api/v1/  → REST
     |  /:project/mcp      → MCP
     |  /:project/graphql  → GraphQL
     |  /:project/ws       → WebSocket
     |  /:project/rpc      → JSON-RPC
     |  /:project/events   → SSE
     v
<span style="color:#f59e0b">@mostajs/mproject</span>  (ProjectManager)
     |  Isole schemas, pool, config par projet
     v
<span style="color:#c084fc">@mostajs/orm</span>  (Dialect)
     |  Un dialect isole par projet
     v
<span style="color:#94a3b8">SGBD</span>  (MongoDB, PostgreSQL, SQLite, ...)
      </pre>
    </div>
  </div>

  </div><!-- /tab-help -->
`;
}

export function getHelpTabScript(): string {
  return `
function showHelpSub(name){
  document.querySelectorAll('.help-sub').forEach(el=>el.style.display='none');
  document.querySelectorAll('.help-subtab').forEach(el=>{el.classList.remove('active');el.style.borderBottomColor='transparent';el.style.color='#94a3b8';});
  const sub=document.getElementById('help-'+name);
  if(sub)sub.style.display='block';
  event.target.classList.add('active');
  event.target.style.borderBottomColor='#38bdf8';
  event.target.style.color='#38bdf8';
}
`;
}
