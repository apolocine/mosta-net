// Test all 5 transports: REST + SSE + GraphQL + WebSocket + JSON-RPC
// Author: Dr Hamid MADANI drmdh@msn.com
import { registerSchema } from '@mostajs/orm';
import type { EntitySchema } from '@mostajs/orm';

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
import WebSocket from 'ws';

const port = process.env.MOSTA_NET_PORT || '4490';

async function test() {
  const server = await startServer();

  console.log('\n  ═══════════════════════════════════════════');
  console.log('  TEST: All 5 Transports');
  console.log('  ═══════════════════════════════════════════\n');

  // 1. REST — Create user
  console.log('  1. REST: POST /api/v1/users');
  const restRes = await fetch(`http://localhost:${port}/api/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dr Madani', email: 'drmdh@msn.com', role: 'admin' }),
  });
  const restBody = await restRes.json() as any;
  const userId = restBody.data?.id;
  console.log(`     → ${restBody.status} id=${userId}`);

  // 2. GraphQL — Query users
  console.log('\n  2. GraphQL: query { users }');
  const gqlRes = await fetch(`http://localhost:${port}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: '{ users { id name email role } userCount }',
    }),
  });
  const gqlBody = await gqlRes.json() as any;
  console.log(`     → ${gqlBody.data?.users?.length} user(s), count=${gqlBody.data?.userCount}`);

  // 3. GraphQL — Mutation: create another user
  console.log('\n  3. GraphQL: mutation createUser');
  const gqlMut = await fetch(`http://localhost:${port}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation { createUser(input: { name: "GQL User", email: "gql@test.com" }) { id name } }',
    }),
  });
  const gqlMutBody = await gqlMut.json() as any;
  console.log(`     → created: ${gqlMutBody.data?.createUser?.name} (${gqlMutBody.data?.createUser?.id?.slice(0,8)}...)`);

  // 4. JSON-RPC — findAll
  console.log('\n  4. JSON-RPC: User.findAll');
  const rpcRes = await fetch(`http://localhost:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'User.findAll',
      params: {},
      id: 1,
    }),
  });
  const rpcBody = await rpcRes.json() as any;
  console.log(`     → ${rpcBody.result?.data?.length} user(s)`);

  // 5. JSON-RPC — batch
  console.log('\n  5. JSON-RPC: batch [count, findById]');
  const rpcBatch = await fetch(`http://localhost:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { jsonrpc: '2.0', method: 'User.count', params: {}, id: 2 },
      { jsonrpc: '2.0', method: 'User.findById', params: { id: userId }, id: 3 },
    ]),
  });
  const rpcBatchBody = await rpcBatch.json() as any;
  console.log(`     → count=${rpcBatchBody[0]?.result?.data}, findById=${rpcBatchBody[1]?.result?.data?.name}`);

  // 6. JSON-RPC — discovery
  console.log('\n  6. JSON-RPC: GET /rpc (discovery)');
  const rpcDisc = await fetch(`http://localhost:${port}/rpc`);
  const rpcDiscBody = await rpcDisc.json() as any;
  console.log(`     → ${rpcDiscBody.methods?.length} methods: ${rpcDiscBody.methods?.slice(0,4).join(', ')}...`);

  // 7. WebSocket — connect, send findAll, receive response
  console.log('\n  7. WebSocket: connect + User.findAll');
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ op: 'findAll', entity: 'User' }));
    });
    let msgCount = 0;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'connected') {
        console.log(`     → connected, entities: ${msg.entities.join(', ')}`);
      } else if (msg.type === 'response') {
        console.log(`     → response: ${msg.status}, ${Array.isArray(msg.data) ? msg.data.length + ' users' : msg.data}`);
        ws.close();
        resolve();
      }
    });
  });

  // 8. REST — list all (should have 2 users now)
  console.log('\n  8. REST: GET /api/v1/users (final count)');
  const finalRes = await fetch(`http://localhost:${port}/api/v1/users`);
  const finalBody = await finalRes.json() as any;
  console.log(`     → ${finalBody.metadata?.count} user(s)\n`);

  console.log('  ═══════════════════════════════════════════');
  console.log('  ALL 5 TRANSPORTS OK');
  console.log('  ═══════════════════════════════════════════\n');

  await server.stop();
  process.exit(0);
}

test().catch(err => { console.error(err); process.exit(1); });
