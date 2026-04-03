#!/usr/bin/env node
// OctoNet MCP — standalone MCP server CLI
// Usage: npx octonet-mcp --dialect=postgres --uri=postgresql://...
// Author: Dr Hamid MADANI drmdh@msn.com

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Sandbox schemas for Smithery scanning
const SANDBOX_SCHEMAS = [
  { name: 'User', fields: ['email', 'name', 'age', 'active'] },
  { name: 'Product', fields: ['title', 'price', 'stock', 'category'] },
  { name: 'Order', fields: ['userId', 'total', 'status', 'createdAt'] },
] as const;

/**
 * Smithery sandbox — returns an McpServer with demo schemas for tool scanning.
 */
export default function createSandboxServer(): McpServer {
  const server = new McpServer(
    { name: 'OctoNet MCP', version: '2.0.42' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  const ops = ['findAll','findById','create','update','delete','count','findOne','search','upsert','deleteMany','updateMany','aggregate','addToSet','pull','increment'];
  for (const schema of SANDBOX_SCHEMAS) {
    for (const op of ops) {
      server.registerTool(`${schema.name}_${op}`, {
        description: `${op} on ${schema.name} entities (fields: ${schema.fields.join(', ')})`,
        inputSchema: z.object({ filter: z.string().optional().describe('JSON filter') }),
      }, async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ status: 'ok', op, entity: schema.name }) }] }));
    }
  }

  server.registerPrompt('describe-schema', { description: 'Describe all entities, fields, relations' }, async () => ({ messages: [{ role: 'assistant' as const, content: { type: 'text' as const, text: 'Entities: ' + SANDBOX_SCHEMAS.map(s => s.name).join(', ') } }] }));
  server.registerPrompt('suggest-query', { description: 'Help build a filter query' }, async () => ({ messages: [{ role: 'assistant' as const, content: { type: 'text' as const, text: 'Suggest a query filter' } }] }));
  server.registerPrompt('explain-data', { description: 'Explain query results in plain language' }, async () => ({ messages: [{ role: 'assistant' as const, content: { type: 'text' as const, text: 'Data explanation' } }] }));
  server.registerPrompt('list-entities', { description: 'Quick entity overview' }, async () => ({ messages: [{ role: 'assistant' as const, content: { type: 'text' as const, text: SANDBOX_SCHEMAS.map(s => `${s.name}: ${s.fields.join(', ')}`).join('\n') } }] }));

  return server;
}

// Normal CLI mode — redirect to main CLI (skip if imported as module for scanning)
const isMainModule = process.argv[1]?.includes('mcp-cli') || process.argv[1]?.includes('octonet-mcp');
if (isMainModule) {
  process.argv.splice(2, 0, 'mcp');
  import('./cli.js');
}
