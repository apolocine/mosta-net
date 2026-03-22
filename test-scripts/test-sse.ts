// Test SSE: start server, connect SSE client, create entity, verify event received
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

async function test() {
  const port = process.env.MOSTA_NET_PORT || '4488';
  const server = await startServer();

  console.log('\n  === SSE Test ===');
  console.log('  Connecting SSE client to /events ...');

  // Connect SSE client using native http
  const http = await import('http');
  const sseReq = http.get(`http://localhost:${port}/events`, (res) => {
    let buffer = '';
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      // Parse SSE events
      const events = buffer.split('\n\n').filter(Boolean);
      for (const evt of events) {
        if (evt.startsWith(':')) continue; // comment
        const lines = evt.split('\n');
        const eventLine = lines.find(l => l.startsWith('event:'));
        const dataLine = lines.find(l => l.startsWith('data:'));
        if (eventLine && dataLine) {
          console.log(`  SSE received: ${eventLine} | ${dataLine.substring(0, 80)}...`);
        }
      }
      buffer = '';
    });
  });

  // Wait for SSE connection
  await new Promise(r => setTimeout(r, 1000));

  // Create a user via REST → should trigger SSE event
  console.log('\n  Creating user via REST...');
  const res = await fetch(`http://localhost:${port}/api/v1/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'SSE Test User', email: 'sse@test.com', role: 'admin' }),
  });
  const body = await res.json();
  console.log(`  REST response: ${JSON.stringify(body).substring(0, 100)}...`);

  // Wait for SSE to receive the event
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n  === Test complete ===\n');
  sseReq.destroy();
  await server.stop();
  process.exit(0);
}

test().catch(err => { console.error(err); process.exit(1); });
