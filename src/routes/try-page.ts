// @mostajs/net — /try landing page (HTML form)
// Served alongside POST /try by registerTryRoutes in routes/try.ts.
// Author: Dr Hamid MADANI <drmdh@msn.com>

import type { FastifyInstance } from 'fastify'

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Try Octonet — get a sandbox apikey in 2 clicks</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  body{background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
  .card{max-width:560px;width:100%;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:2rem;box-shadow:0 20px 50px rgba(0,0,0,.3)}
  h1{font-size:1.5rem;margin-bottom:.5rem;color:#f1f5f9}
  p{color:#94a3b8;font-size:.95rem;margin-bottom:1.25rem;line-height:1.5}
  .badge{display:inline-block;padding:.15rem .5rem;background:#0ea5e9;color:#fff;border-radius:4px;font-size:.7rem;font-weight:600;margin-right:.5rem;vertical-align:2px}
  label{display:block;font-size:.85rem;color:#94a3b8;margin-bottom:.4rem}
  input[type="text"]{width:100%;padding:.75rem 1rem;background:#0f172a;border:1px solid #475569;border-radius:6px;color:#f1f5f9;font-size:1rem;font-family:ui-monospace,monospace}
  input[type="text"]:focus{outline:none;border-color:#0ea5e9}
  button{margin-top:1rem;width:100%;padding:.85rem;background:#0ea5e9;color:#fff;border:none;border-radius:6px;font-size:1rem;font-weight:600;cursor:pointer;transition:background .15s}
  button:hover:not(:disabled){background:#0284c7}
  button:disabled{background:#475569;cursor:not-allowed}
  .result{margin-top:1.5rem;padding:1rem;background:#0f172a;border:1px solid #334155;border-radius:8px;font-family:ui-monospace,monospace;font-size:.85rem;display:none}
  .result.visible{display:block}
  .result.error{border-color:#dc2626;background:#7f1d1d20}
  .key{background:#022c22;color:#86efac;padding:.75rem;border-radius:4px;word-break:break-all;font-size:.8rem;margin:.5rem 0;cursor:pointer;border:1px solid #14532d}
  .key:hover{background:#022e26}
  .copy-hint{font-size:.7rem;color:#64748b;margin-top:.25rem;display:block}
  pre{white-space:pre-wrap;word-break:break-all;font-size:.75rem;color:#cbd5e1;background:#020617;padding:.75rem;border-radius:4px;margin:.5rem 0;overflow-x:auto}
  .meta{font-size:.75rem;color:#64748b;margin-top:.5rem}
  .meta b{color:#94a3b8}
  a{color:#0ea5e9;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
  <h1><span class="badge">T1</span>Try Octonet — sandbox in 2 clicks</h1>
  <p>Pick an alias. We provision a private SQLite sandbox + a read/write API key scoped to it. <b>Free, no email, expires after 7 days idle.</b></p>

  <form id="tryForm">
    <label for="alias">Your alias (3-30 chars, letters/digits/hyphens)</label>
    <input type="text" id="alias" name="alias" placeholder="alice-42" autocomplete="off" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9-]+">
    <button type="submit" id="submitBtn">Generate API key</button>
  </form>

  <div class="result" id="result"></div>

  <p class="meta" style="margin-top:1.5rem;text-align:center">
    <a href="https://octonet.amia.fr/" target="_blank">octonet.amia.fr</a> &middot;
    <a href="https://github.com/apolocine/mosta-net-clients" target="_blank">14 NetClients</a> &middot;
    Limit 10 sandboxes/h/IP &middot; 500 req/day each
  </p>
</div>

<script>
const form = document.getElementById('tryForm');
const btn  = document.getElementById('submitBtn');
const res  = document.getElementById('result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  btn.disabled = true; btn.textContent = 'Provisioning…';
  res.className = 'result'; res.innerHTML = '';

  const alias = document.getElementById('alias').value.trim();
  try {
    const r = await fetch('/try', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias }),
    });
    const j = await r.json();

    if (!r.ok || j.status !== 'ok') {
      res.className = 'result visible error';
      res.innerHTML = '<b>Error:</b> ' + (j.error?.message || 'unknown');
      return;
    }
    const d = j.data;
    res.className = 'result visible';
    res.innerHTML = \`
      <b>Sandbox ready ✓</b><br><br>
      <b>API Key</b> <span class="copy-hint">(click to copy — shown once, save it now)</span>
      <div class="key" onclick="navigator.clipboard.writeText(this.textContent.trim());this.style.background='#14532d'">\${d.apiKey}</div>
      <div class="meta">
        <b>Project:</b> <code>\${d.projectSlug}</code><br>
        <b>Permissions:</b> read/write on sandbox via REST + MCP<br>
        <b>Expires:</b> \${d.expiresAt}<br>
        <b>Quota:</b> \${d.quota.reqPerDay} requests/day
      </div>
      <b>Try it now</b>
      <pre>\${d.exampleCurl}</pre>
      <b>MCP endpoint (Claude Desktop / Smithery)</b>
      <pre>\${d.mcpUrl}</pre>
      <p class="meta" style="margin-top:1rem">
        Use this key in any of the <a href="https://github.com/apolocine/mosta-net-clients" target="_blank">14 NetClients</a> via <code>MOSTAJS_NET_API_KEY</code>.
      </p>
    \`;
  } catch (err) {
    res.className = 'result visible error';
    res.innerHTML = '<b>Network error:</b> ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Generate API key';
  }
});
</script>
</body>
</html>`

export function registerTryPage(app: FastifyInstance): void {
  app.get('/try', async (_req, reply) => {
    reply.type('text/html; charset=utf-8')
    return PAGE_HTML
  })
}
