// @mostajs/net — Transport Factory
// Lazy-loads transport adapters (like getDialect() in @mostajs/orm)
// Author: Dr Hamid MADANI drmdh@msn.com

import type { ITransport, TransportConfig } from './types.js';
import type { TransportName } from './config.js';

/**
 * Dynamically load a transport module.
 * Only the selected transport is loaded — no unused dependencies in memory.
 * Mirror of loadDialectModule() in @mostajs/orm.
 */
async function loadTransportModule(name: TransportName): Promise<{ createTransport: () => ITransport }> {
  switch (name) {
    case 'rest':     return import('../transports/rest.transport.js');
    case 'sse':      return import('../transports/sse.transport.js');
    case 'graphql':  return import('../transports/graphql.transport.js');
    case 'ws':       return import('../transports/ws.transport.js');
    case 'jsonrpc':  return import('../transports/jsonrpc.transport.js');
    case 'mcp':      return import('../transports/mcp.transport.js');
    // Future transports:
    // case 'sse':      return import('../transports/sse.transport.js');
    // case 'trpc':     return import('../transports/trpc.transport.js');
    // case 'mcp':      return import('../transports/mcp.transport.js');
    // case 'odata':    return import('../transports/odata.transport.js');
    // case 'arrow':    return import('../transports/arrow.transport.js');
    // case 'jsonrpc':  return import('../transports/jsonrpc.transport.js');
    // case 'nats':     return import('../transports/nats.transport.js');
    default:
      throw new Error(`Transport "${name}" is not yet implemented`);
  }
}

/** Registry of active transport instances */
const activeTransports = new Map<string, ITransport>();

/**
 * Get or create a transport by name.
 * Returns null if the transport is not enabled in config.
 */
export async function getTransport(name: TransportName, config: TransportConfig): Promise<ITransport | null> {
  if (!config.enabled) return null;

  if (activeTransports.has(name)) {
    return activeTransports.get(name)!;
  }

  const mod = await loadTransportModule(name);
  const transport = mod.createTransport();
  activeTransports.set(name, transport);
  return transport;
}

/**
 * Get all active (started) transports.
 */
export function getActiveTransports(): ITransport[] {
  return Array.from(activeTransports.values());
}

/**
 * Stop all active transports.
 */
export async function stopAllTransports(): Promise<void> {
  for (const transport of activeTransports.values()) {
    await transport.stop();
  }
  activeTransports.clear();
}
