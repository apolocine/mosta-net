// @mostajs/net — Configuration loader
// Reads MOSTA_NET_* from process.env (populated by .env.local)
// Author: Dr Hamid MADANI drmdh@msn.com

import type { NetServerConfig, TransportConfig } from './types.js';

/** All known transport names */
export const TRANSPORT_NAMES = [
  'rest', 'grpc', 'graphql', 'ws', 'sse',
  'trpc', 'mcp', 'odata', 'arrow', 'jsonrpc', 'nats',
] as const;

export type TransportName = typeof TRANSPORT_NAMES[number];

/** Default port for the main HTTP server */
const DEFAULT_PORT = 4488;

/** Default ports for transports that need dedicated ports */
const DEFAULT_TRANSPORT_PORTS: Partial<Record<TransportName, number>> = {
  grpc: 50051,
  arrow: 50052,
};

/** Default HTTP paths for transports mounted on the main server */
const DEFAULT_TRANSPORT_PATHS: Partial<Record<TransportName, string>> = {
  rest: '/api/v1',
  graphql: '/graphql',
  ws: '/ws',
  sse: '/events',
  trpc: '/trpc',
  mcp: '/mcp',
  odata: '/odata',
  jsonrpc: '/rpc',
};

/**
 * Load net configuration from environment variables.
 *
 * Convention: MOSTA_NET_{TRANSPORT}_ENABLED, MOSTA_NET_{TRANSPORT}_PORT, MOSTA_NET_{TRANSPORT}_PATH
 * Example: MOSTA_NET_REST_ENABLED=true, MOSTA_NET_GRPC_PORT=50051
 */
export function loadNetConfig(): NetServerConfig {
  const port = parseInt(process.env.MOSTA_NET_PORT || '', 10) || DEFAULT_PORT;

  const transports: Record<string, TransportConfig> = {};

  for (const name of TRANSPORT_NAMES) {
    const upper = name.toUpperCase();
    const enabled = process.env[`MOSTA_NET_${upper}_ENABLED`] === 'true';

    transports[name] = {
      enabled,
      port: parseInt(process.env[`MOSTA_NET_${upper}_PORT`] || '', 10) || DEFAULT_TRANSPORT_PORTS[name],
      path: process.env[`MOSTA_NET_${upper}_PATH`] || DEFAULT_TRANSPORT_PATHS[name],
      options: {},
    };

    // Transport-specific options
    if (name === 'mcp') {
      transports[name].options!.mode = process.env.MOSTA_NET_MCP_MODE || 'http';
    }
    if (name === 'nats') {
      transports[name].options!.url = process.env.MOSTA_NET_NATS_URL || 'nats://localhost:4222';
    }
  }

  return { port, transports };
}

/**
 * Get the list of enabled transport names from config.
 */
export function getEnabledTransports(config: NetServerConfig): TransportName[] {
  return TRANSPORT_NAMES.filter(name => config.transports[name]?.enabled);
}
