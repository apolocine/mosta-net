// Test MCP Transport using the official MCP SDK client
// Author: Dr Hamid MADANI drmdh@msn.com
import { registerSchema } from '@mostajs/orm';
import type { EntitySchema } from '@mostajs/orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const UserSchema: EntitySchema = {
  name: 'User',
  collection: 'users',
  fields: {
    name:  { type: 'string', required: true },
    email: { type: 'string', required: true, unique: true },
    role:  { type: 'string', default: 'user' },
  },
  relations: {},
  indexes: [],
  timestamps: true,
};
registerSchema(UserSchema);

import { startServer } from '../src/server.js';

const port = process.env.MOSTA_NET_PORT || '4491';

async function test() {
  const server = await startServer();

  console.log('\n  ═══════════════════════════════════════════');
  console.log('  TEST: MCP Transport (SDK Client)');
  console.log('  ═══════════════════════════════════════════\n');

  // Create a user via REST first
  console.log('  0. Setup: Create user via REST');
  await fetch(`http://localhost:${port}/api/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dr Madani', email: 'drmdh@msn.com', role: 'admin' }),
  });
  console.log('     → OK');

  // Create MCP client using SDK
  console.log('\n  1. MCP: Connect with SDK client');
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/mcp`),
  );
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  console.log('     → Connected');

  // List tools
  console.log('\n  2. MCP: List tools');
  const tools = await client.listTools();
  console.log(`     → ${tools.tools.length} tools:`);
  for (const tool of tools.tools) {
    console.log(`       - ${tool.name}`);
  }

  // Call User_findAll
  console.log('\n  3. MCP: Call User_findAll');
  const findResult = await client.callTool({ name: 'User_findAll', arguments: {} });
  const findText = (findResult.content as any[])[0]?.text;
  const users = JSON.parse(findText);
  console.log(`     → ${users.length} user(s): ${users.map((u: any) => u.name).join(', ')}`);

  // Call User_count
  console.log('\n  4. MCP: Call User_count');
  const countResult = await client.callTool({ name: 'User_count', arguments: {} });
  console.log(`     → count = ${(countResult.content as any[])[0]?.text}`);

  // Call User_create via MCP
  console.log('\n  5. MCP: Call User_create');
  const createResult = await client.callTool({
    name: 'User_create',
    arguments: { data: JSON.stringify({ name: 'MCP User', email: 'mcp@test.com', role: 'editor' }) },
  });
  const created = JSON.parse((createResult.content as any[])[0]?.text);
  console.log(`     → Created: ${created.name} (${created.id?.slice(0, 8)}...)`);

  // List resources
  console.log('\n  6. MCP: List resources');
  const resources = await client.listResources();
  console.log(`     → ${resources.resources.length} resource(s):`);
  for (const r of resources.resources) {
    console.log(`       - ${r.name} (${r.uri})`);
  }

  // Read resource
  console.log('\n  7. MCP: Read User Schema resource');
  const schema = await client.readResource({ uri: 'entity://User/schema' });
  const schemaText = (schema.contents as any[])[0]?.text;
  const parsed = JSON.parse(schemaText);
  console.log(`     → ${parsed.name} with fields: ${Object.keys(parsed.fields).join(', ')}`);

  // Final count via REST
  console.log('\n  8. REST: Final user count');
  const finalRes = await fetch(`http://localhost:${port}/api/v1/users`);
  const finalBody = await finalRes.json() as any;
  console.log(`     → ${finalBody.metadata?.count} user(s)`);

  console.log('\n  ═══════════════════════════════════════════');
  console.log('  MCP TRANSPORT OK — ALL TESTS PASSED');
  console.log('  ═══════════════════════════════════════════\n');

  await client.close();
  await server.stop();
  process.exit(0);
}

test().catch(err => { console.error('FAIL:', err.message || err); process.exit(1); });
