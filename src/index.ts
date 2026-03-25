// @mostajs/net — Multi-protocol transport layer for @mostajs/orm
// Author: Dr Hamid MADANI drmdh@msn.com

// Core types
export type {
  ITransport,
  TransportConfig,
  TransportInfo,
  TransportContext,
  TransportMiddleware,
  NetServerConfig,
} from './core/types.js';

// Config
export { loadNetConfig, getEnabledTransports, TRANSPORT_NAMES } from './core/config.js';
export type { TransportName } from './core/config.js';

// Factory
export { getTransport, getActiveTransports, stopAllTransports } from './core/factory.js';

// Middleware
export { composeMiddleware, loggingMiddleware } from './core/middleware.js';

// Transports
export { RestTransport } from './transports/rest.transport.js';
export { SSETransport } from './transports/sse.transport.js';
export { GraphQLTransport } from './transports/graphql.transport.js';
export { WebSocketTransport } from './transports/ws.transport.js';
export { JsonRpcTransport } from './transports/jsonrpc.transport.js';
export { McpTransport } from './transports/mcp.transport.js';

// Auth / API Keys
export {
  readApiKeys,
  writeApiKeys,
  generateApiKey,
  hashApiKey,
  createSubscription,
  revokeSubscription,
  validateApiKey,
  checkPermission,
} from './auth/apikeys.js';
export type { Subscription, ApiKeysFile } from './auth/apikeys.js';
export { apiKeyMiddleware } from './auth/apikey-middleware.js';

// Schema loader
export { loadSchemasFromJson, scanSchemaDirs, generateSchemasJson, getSchemasConfig, parseSchemasFromZip } from './lib/schema-loader.js';

// Server
export { startServer } from './server.js';
export type { NetServer } from './server.js';
