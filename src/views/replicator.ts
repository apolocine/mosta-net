// OctoNet Dashboard — Replicas tab (CQRS + CDC)
// Author: Dr Hamid MADANI drmdh@msn.com

export function getReplicatorTabHtml(): string {
  return `
  <div id="tab-replicas" class="tab-content">
  <h2>Replication &amp; CQRS <span style="font-size:.75rem;color:#64748b;font-weight:normal">— master/slave, read routing, CDC rules</span></h2>

  <div class="card">
    <h3 style="margin-bottom:.75rem">Project Replicas</h3>
    <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.75rem">
      <select id="replicaProject" style="padding:.4rem;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:.8rem" onchange="loadReplicas()">
        <option value="">Select project...</option>
      </select>
      <button class="btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="loadReplicas()">Refresh</button>
    </div>
    <table style="width:100%;font-size:.8rem;border-collapse:collapse">
      <thead><tr style="border-bottom:1px solid #334155;text-align:left">
        <th style="padding:.4rem">Name</th><th>Role</th><th>Dialect</th><th>Status</th><th>Lag</th><th>Pool</th><th>Actions</th>
      </tr></thead>
      <tbody id="replicasBody"><tr><td colspan="7" style="color:#64748b;padding:.5rem">Select a project above</td></tr></tbody>
    </table>
  </div>

  <div class="card" style="margin-top:.75rem">
    <h3 style="margin-bottom:.75rem">Add Replica</h3>
    <form id="addReplicaForm" onsubmit="addReplicaSubmit(event)" style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:end">
      <div><label style="font-size:.7rem;color:#94a3b8">Name</label><br><input id="rName" style="padding:.35rem;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:.8rem;width:120px" required></div>
      <div><label style="font-size:.7rem;color:#94a3b8">Role</label><br><select id="rRole" style="padding:.35rem;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:.8rem"><option value="slave">Slave</option><option value="master">Master</option></select></div>
      <div><label style="font-size:.7rem;color:#94a3b8">Dialect</label><br><select id="rDialect" style="padding:.35rem;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:.8rem"><option>sqlite</option><option>postgres</option><option>mongodb</option><option>mysql</option><option>mariadb</option><option>oracle</option><option>mssql</option><option>cockroachdb</option></select></div>
      <div style="flex:1"><label style="font-size:.7rem;color:#94a3b8">URI</label><br><input id="rUri" style="padding:.35rem;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:.8rem;width:100%" placeholder=":memory:" required></div>
      <button type="submit" class="btn" style="font-size:.75rem;padding:.35rem .8rem">Add</button>
    </form>
    <div id="replicaMsg" style="font-size:.8rem;margin-top:.5rem"></div>
  </div>

  <div class="card" style="margin-top:.75rem">
    <h3 style="margin-bottom:.75rem">Read Routing</h3>
    <div style="display:flex;gap:1rem;align-items:center;font-size:.85rem">
      <label><input type="radio" name="routing" value="round-robin" checked onchange="setRouting(this.value)"> Round-robin</label>
      <label><input type="radio" name="routing" value="least-lag" onchange="setRouting(this.value)"> Least-lag</label>
      <label><input type="radio" name="routing" value="random" onchange="setRouting(this.value)"> Random</label>
      <span id="routingMsg" style="color:#22c55e;font-size:.75rem"></span>
    </div>
  </div>

  <div class="card" style="margin-top:.75rem">
    <h3 style="margin-bottom:.75rem">Replication Rules (CDC)</h3>
    <table style="width:100%;font-size:.8rem;border-collapse:collapse">
      <thead><tr style="border-bottom:1px solid #334155;text-align:left">
        <th style="padding:.4rem">Name</th><th>Source</th><th>Target</th><th>Mode</th><th>Collections</th><th>Conflict</th><th>Actions</th>
      </tr></thead>
      <tbody id="rulesBody"><tr><td colspan="7" style="color:#64748b;padding:.5rem">No rules</td></tr></tbody>
    </table>
    <div style="margin-top:.5rem">
      <button class="btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="loadRules()">Refresh Rules</button>
    </div>
  </div>

  </div><!-- /tab-replicas -->
`;
}

export function getReplicatorTabScript(): string {
  return `
// ── Replicas tab functions ──
async function loadReplicaProjects(){
  const sel=document.getElementById('replicaProject');
  try{
    const res=await fetch('/api/projects');
    const projects=await res.json();
    sel.innerHTML='<option value="">Select project...</option>'+projects.map(p=>'<option value="'+p.name+'">'+p.name+' ('+p.dialect+')</option>').join('');
  }catch{}
}
async function loadReplicas(){
  const proj=document.getElementById('replicaProject').value;
  const tbody=document.getElementById('replicasBody');
  if(!proj){tbody.innerHTML='<tr><td colspan="7" style="color:#64748b;padding:.5rem">Select a project above</td></tr>';return;}
  try{
    const res=await fetch('/api/projects/'+proj+'/replicas');
    const replicas=await res.json();
    if(!replicas.length){tbody.innerHTML='<tr><td colspan="7" style="color:#64748b;padding:.5rem">No replicas for '+proj+'</td></tr>';return;}
    tbody.innerHTML=replicas.map(function(r){return '<tr style="border-bottom:1px solid #1e293b">'+
      '<td style="padding:.4rem">'+r.name+'</td>'+
      '<td><span style="background:'+(r.role==='master'?'#3b82f6':'#6366f1')+';color:#fff;padding:1px 6px;border-radius:3px;font-size:.7rem">'+r.role+'</span></td>'+
      '<td>'+r.dialect+'</td>'+
      '<td><span style="color:'+(r.status==='connected'?'#22c55e':r.status==='error'?'#ef4444':'#94a3b8')+'">'+r.status+'</span></td>'+
      '<td>'+(r.lag!=null?r.lag+'ms':'—')+'</td>'+
      '<td>'+r.poolMax+'</td>'+
      '<td style="display:flex;gap:.3rem">'+
        (r.role==='slave'?'<button class="btn" style="font-size:.65rem;padding:2px 6px;background:#f59e0b" onclick="promoteReplica(\\''+proj+'\\',\\''+r.name+'\\')">Promote</button>':'')+
        '<button class="btn" style="font-size:.65rem;padding:2px 6px;background:#ef4444" onclick="removeReplica(\\''+proj+'\\',\\''+r.name+'\\')">Remove</button>'+
      '</td></tr>'}).join('');
  }catch(e){tbody.innerHTML='<tr><td colspan="7" style="color:#ef4444">Error: '+e.message+'</td></tr>';}
}
async function addReplicaSubmit(ev){
  ev.preventDefault();
  const proj=document.getElementById('replicaProject').value;
  const msg=document.getElementById('replicaMsg');
  if(!proj){msg.innerHTML='<span style="color:#ef4444">Select a project first</span>';return;}
  try{
    const res=await fetch('/api/projects/'+proj+'/replicas',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:document.getElementById('rName').value,role:document.getElementById('rRole').value,dialect:document.getElementById('rDialect').value,uri:document.getElementById('rUri').value})});
    const data=await res.json();
    msg.innerHTML=data.ok?'<span style="color:#22c55e">'+data.message+'</span>':'<span style="color:#ef4444">'+data.error+'</span>';
    if(data.ok){document.getElementById('rName').value='';document.getElementById('rUri').value='';loadReplicas();}
  }catch(e){msg.innerHTML='<span style="color:#ef4444">'+e.message+'</span>';}
}
async function removeReplica(proj,name){
  if(!confirm('Remove replica "'+name+'" from "'+proj+'"?'))return;
  try{await fetch('/api/projects/'+proj+'/replicas/'+name,{method:'DELETE'});loadReplicas();}catch{}
}
async function promoteReplica(proj,name){
  if(!confirm('Promote "'+name+'" to master in "'+proj+'"?'))return;
  try{await fetch('/api/projects/'+proj+'/replicas/'+name+'/promote',{method:'POST'});loadReplicas();}catch{}
}
async function setRouting(strategy){
  const proj=document.getElementById('replicaProject').value;
  const msg=document.getElementById('routingMsg');
  if(!proj){msg.textContent='Select a project first';return;}
  try{
    const res=await fetch('/api/projects/'+proj+'/read-routing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:strategy})});
    const data=await res.json();
    msg.textContent=data.ok?'Set to '+strategy:'Error';
    setTimeout(function(){msg.textContent=''},3000);
  }catch{}
}
async function loadRules(){
  const tbody=document.getElementById('rulesBody');
  try{
    const res=await fetch('/api/replicas/rules');
    const data=await res.json();
    if(!data.rules||!data.rules.length){tbody.innerHTML='<tr><td colspan="7" style="color:#64748b;padding:.5rem">No rules</td></tr>';return;}
    tbody.innerHTML=data.rules.map(function(r){return '<tr style="border-bottom:1px solid #1e293b">'+
      '<td style="padding:.4rem">'+r.name+'</td><td>'+r.source+'</td><td>'+r.target+'</td>'+
      '<td>'+r.mode+'</td><td style="font-size:.7rem">'+r.collections.join(', ')+'</td><td>'+r.conflictResolution+'</td>'+
      '<td style="display:flex;gap:.3rem">'+
        '<button class="btn" style="font-size:.65rem;padding:2px 6px;background:#6366f1" onclick="syncRule(\\''+r.name+'\\')">Sync</button>'+
        '<button class="btn" style="font-size:.65rem;padding:2px 6px;background:#ef4444" onclick="deleteRule(\\''+r.name+'\\')">Del</button>'+
      '</td></tr>'}).join('');
  }catch(e){tbody.innerHTML='<tr><td colspan="7" style="color:#ef4444">'+e.message+'</td></tr>';}
}
async function syncRule(name){
  try{var res=await fetch('/api/replicas/rules/'+name+'/sync',{method:'POST'});var d=await res.json();alert(d.ok?'Sync OK — '+d.stats.recordsSynced+' records':'Error: '+d.error);}catch(e){alert(e.message);}
}
async function deleteRule(name){
  if(!confirm('Delete rule "'+name+'"?'))return;
  try{await fetch('/api/replicas/rules/'+name,{method:'DELETE'});loadRules();}catch{}
}
`;
}
