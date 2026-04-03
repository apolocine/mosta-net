#!/usr/bin/env node
// OctoNet MCP — standalone MCP server CLI
// Usage: npx octonet-mcp --dialect=postgres --uri=postgresql://...
// Author: Dr Hamid MADANI drmdh@msn.com

// Redirect to main CLI with 'mcp' command
process.argv.splice(2, 0, 'mcp');
import('./cli.js');
