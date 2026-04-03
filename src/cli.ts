#!/usr/bin/env node
// @mostajs/net CLI — `npx @mostajs/net serve`
// Author: Dr Hamid MADANI drmdh@msn.com

import { loadNetConfig, getEnabledTransports, TRANSPORT_NAMES } from './core/config.js';

const args = process.argv.slice(2);
const command = args[0];
const arg1 = args[1];
const arg2 = args[2];

async function main() {
  switch (command) {
    case 'generate-apikey': {
      const { createSubscription } = await import('./auth/apikeys.js');
      const name = arg1 || 'default';
      const mode = (arg2 === 'test' ? 'test' : 'live') as 'live' | 'test';
      const { subscription, clearKey } = createSubscription(name, { '*': { '*': 'crud' } }, mode);
      console.log(`\n  API Key generated for "${subscription.name}":`);
      console.log(`  Key:  ${clearKey}`);
      console.log(`  Hash: ${subscription.hash}`);
      console.log(`  Mode: ${mode}`);
      console.log(`\n  Saved in .mosta/apikeys.json\n`);
      break;
    }

    case 'hash-password': {
      if (!arg1) {
        console.log('Usage: mostajs-net hash-password <password>');
        process.exit(1);
      }
      // Dynamic import to avoid requiring bcrypt if not used
      // Use SHA-256 for password hashing (no bcrypt dependency required)
      const { createHash } = await import('crypto');
      const hash = createHash('sha256').update(arg1).digest('hex');
      console.log(`\n  Password hash (SHA-256):`);
      console.log(`  ${hash}\n`);
      console.log(`  Add to .env.local:`);
      console.log(`  MOSTA_ADMIN_PASS_HASH=${hash}\n`);
      break;
    }

    case 'serve':
    case undefined: {
      console.log(`
  \x1b[1m@mostajs/net\x1b[0m v1.0.0-alpha.1
  ${'─'.repeat(35)}
`);

      const config = loadNetConfig();
      const enabled = getEnabledTransports(config);

      if (enabled.length === 0) {
        console.log('  \x1b[33m⚠\x1b[0m No transports enabled.');
        console.log(`  Set MOSTA_NET_{TRANSPORT}_ENABLED=true in .env.local`);
        console.log(`  Available: ${TRANSPORT_NAMES.join(', ')}\n`);
        process.exit(1);
      }

      console.log(`  Transports enabled: ${enabled.join(', ')}`);
      console.log(`  Port: ${config.port}\n`);

      // Dynamic import to avoid loading ORM at parse time
      const { startServer } = await import('./server.js');
      const server = await startServer();

      // Graceful shutdown
      const shutdown = async () => {
        console.log('\n  Shutting down...');
        await server.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      break;
    }

    case 'mcp': {
      // MCP-only mode: npx mostajs-net mcp --dialect=X --uri=Y
      // Or: npx octonet-mcp --dialect=X --uri=Y
      const cliArgs = args.slice(1);
      const getArg = (name: string) => {
        const a = cliArgs.find(a => a.startsWith(`--${name}=`));
        return a ? a.split('=').slice(1).join('=') : undefined;
      };
      const d = getArg('dialect') || process.env.DB_DIALECT;
      const u = getArg('uri') || process.env.SGBD_URI;
      const port = getArg('port') || process.env.MOSTA_NET_PORT || '4488';
      const projects = getArg('projects') || process.env.MOSTA_PROJECTS;

      if (!d || !u) {
        console.log(`
  \x1b[1mOctoNet MCP\x1b[0m — MCP server for 13 databases
  ${'─'.repeat(45)}

  Usage:
    npx octonet-mcp --dialect=postgres --uri=postgresql://user:pass@host:5432/db
    npx octonet-mcp --dialect=sqlite --uri=:memory:
    npx octonet-mcp --dialect=mongodb --uri=mongodb://user:pass@host:27017/db
    npx octonet-mcp --projects=./projects-tree.json

  Options:
    --dialect=<dialect>   Database dialect (postgres, mysql, sqlite, mongodb, oracle, mssql, db2, hana, hsqldb, sybase, cockroachdb, spanner)
    --uri=<uri>           Connection string
    --port=<port>         HTTP port (default: 4488)
    --projects=<file>     Multi-project JSON config file

  Environment variables:
    DB_DIALECT, SGBD_URI, MOSTA_NET_PORT, MOSTA_PROJECTS
`);
        process.exit(1);
      }

      // Set env for the server
      process.env.DB_DIALECT = d;
      process.env.SGBD_URI = u;
      process.env.MOSTA_NET_PORT = port;
      process.env.MOSTA_NET_MCP_ENABLED = 'true';
      process.env.MOSTA_NET_REST_ENABLED = 'true'; // REST for admin API
      process.env.DB_SCHEMA_STRATEGY = getArg('strategy') || 'update';
      if (projects) process.env.MOSTA_PROJECTS = projects;

      console.log(`
  \x1b[1mOctoNet MCP\x1b[0m — 1 server, 13 databases, zero config
  ${'─'.repeat(50)}
  Dialect:  \x1b[32m${d}\x1b[0m
  URI:      \x1b[2m${u.replace(/:([^@]+)@/, ':***@')}\x1b[0m
  Port:     \x1b[33m${port}\x1b[0m (MCP: /mcp, REST: /api/v1)
  ${projects ? 'Projects: ' + projects : ''}
`);

      const { startServer } = await import('./server.js');
      const server = await startServer();
      const shutdown = async () => { await server.stop(); process.exit(0); };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      break;
    }

    case 'info': {
      const config = loadNetConfig();
      const enabled = getEnabledTransports(config);
      const { readApiKeys } = await import('./auth/apikeys.js');
      const keys = readApiKeys();
      console.log(JSON.stringify({
        port: config.port,
        transports: { enabled, all: [...TRANSPORT_NAMES] },
        apikeys: keys.subscriptions.map(s => ({ name: s.name, status: s.status, created: s.created })),
      }, null, 2));
      break;
    }

    case 'list-keys': {
      const { readApiKeys } = await import('./auth/apikeys.js');
      const keys = readApiKeys();
      if (keys.subscriptions.length === 0) {
        console.log('\n  No API keys configured. Use: mostajs-net generate-apikey <name>\n');
      } else {
        console.log(`\n  API Keys (${keys.subscriptions.length}):`);
        for (const s of keys.subscriptions) {
          const icon = s.status === 'active' ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
          console.log(`  ${icon} ${s.name} (${s.status}, ${s.created})`);
        }
        console.log('');
      }
      break;
    }

    case 'revoke-key': {
      if (!arg1) {
        console.log('Usage: mostajs-net revoke-key <name>');
        process.exit(1);
      }
      const { revokeSubscription } = await import('./auth/apikeys.js');
      if (revokeSubscription(arg1)) {
        console.log(`\n  Subscription "${arg1}" revoked.\n`);
      } else {
        console.log(`\n  Subscription "${arg1}" not found.\n`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Usage: mostajs-net <command>');
      console.log('');
      console.log('Commands:');
      console.log('  serve              Start the server');
      console.log('  info               Show config and API keys');
      console.log('  generate-apikey    Generate a new API key');
      console.log('  list-keys          List all API keys');
      console.log('  revoke-key <name>  Revoke an API key');
      console.log('  hash-password <pw> Hash a password');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('\x1b[31mFatal:\x1b[0m', err.message || err);
  process.exit(1);
});
