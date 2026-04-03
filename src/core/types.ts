// @mostajs/net — Core Types
// ITransport interface (mirror of IDialect in @mostajs/orm)
// Author: Dr Hamid MADANI drmdh@msn.com

import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';

// ============================================================
// Transport Configuration
// ============================================================

export interface TransportConfig {
  /** Is this transport enabled? */
  enabled: boolean;
  /** Dedicated port (for transports that need their own port, e.g. gRPC) */
  port?: number;
  /** HTTP path prefix (for transports mounted on the main HTTP server) */
  path?: string;
  /** Transport-specific options */
  options?: Record<string, unknown>;
}

// ============================================================
// Transport Info (for admin dashboard)
// ============================================================

export interface TransportInfo {
  /** Transport identifier (e.g. 'rest', 'grpc', 'graphql') */
  name: string;
  /** Current status */
  status: 'running' | 'stopped' | 'error';
  /** Listening URL (e.g. "http://localhost:4488/api/v1") */
  url?: string;
  /** Dedicated port (e.g. 50051 for gRPC) */
  port?: number;
  /** Registered entity names */
  entities: string[];
  /** Runtime stats */
  stats: {
    requests: number;
    errors: number;
    startedAt: number;
  };
}

// ============================================================
// Transport Middleware
// ============================================================

export interface TransportContext {
  /** Transport name that received the request */
  transport: string;
  /** API key (if present in the request) */
  apiKey?: string;
  /** Resolved subscription name (after API key validation) */
  subscription?: string;
  /** Resolved permissions for this request */
  permissions?: Record<string, string>;
  /** Project name for multi-project routing (resolved from path or header) — unique name, not a numeric ID */
  projectName?: string;
  /** Extra metadata per transport */
  meta?: Record<string, unknown>;
}

export type TransportMiddleware = (
  req: OrmRequest,
  ctx: TransportContext,
  next: () => Promise<OrmResponse>,
) => Promise<OrmResponse>;

// ============================================================
// ITransport — the Transport Adapter interface
// Mirror of IDialect in @mostajs/orm
// ============================================================

export interface ITransport {
  /** Transport identifier (e.g. 'rest', 'grpc', 'graphql') */
  readonly name: string;

  /** Initialize and start the transport */
  start(config: TransportConfig): Promise<void>;

  /** Stop the transport gracefully */
  stop(): Promise<void>;

  /** Register an entity schema — generates endpoints for this entity */
  registerEntity(schema: EntitySchema): void;

  /** Add a middleware to the transport pipeline */
  use(middleware: TransportMiddleware): void;

  /** Get runtime info (for admin dashboard) */
  getInfo(): TransportInfo;
}

// ============================================================
// Net Server Configuration
// ============================================================

export interface NetServerConfig {
  /** Main HTTP port (shared by REST, GraphQL, SSE, etc.) */
  port: number;
  /** Transport configurations keyed by transport name */
  transports: Record<string, TransportConfig>;
}
