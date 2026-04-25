// @mostajs/net — Build TransportContext from request metadata.
//
// Avant ce helper, chaque transport instanciait `ctx = { transport }` sans
// extraire l'API key, le projet, l'IP. Conséquence : le middleware d'authz
// recevait un contexte vide → bypass de fait. Ce helper unifie l'extraction
// à partir de headers/query déjà normalisés par le transport.
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import type { TransportContext } from './types.js';

export interface AuthContextSource {
  /** Transport name — 'rest' | 'graphql' | 'mcp' | … */
  transport: string;
  /** HTTP-style headers (lowercased keys preferred). */
  headers?: Record<string, string | string[] | undefined>;
  /** Query string params. */
  query?: Record<string, string | string[] | undefined>;
  /** Pre-resolved client IP (overrides X-Forwarded-For derivation). */
  ip?: string;
  /** Extra metadata to merge under ctx.meta. */
  meta?: Record<string, unknown>;
}

function pickHeader(headers: Record<string, any> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v[0] : String(v);
}

function pickQuery(query: Record<string, any> | undefined, name: string): string | undefined {
  if (!query) return undefined;
  const v = query[name];
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v[0] : String(v);
}

export function extractAuthContext(src: AuthContextSource): TransportContext {
  const { transport, headers, query, ip, meta } = src;

  // API key — tries (in order) :
  //   X-API-Key header → Authorization: Bearer xxx → ?apikey= query → ?api_key= query
  const apiKey =
    pickHeader(headers, 'x-api-key') ??
    (pickHeader(headers, 'authorization')?.replace(/^Bearer\s+/i, '').trim() || undefined) ??
    pickQuery(query, 'apikey') ??
    pickQuery(query, 'api_key');

  // Project name — X-Project header or ?project= query.
  const projectName =
    pickHeader(headers, 'x-project') ??
    pickQuery(query, 'project');

  // Client IP — pre-resolved or X-Forwarded-For first hop.
  const resolvedIp = ip
    ?? pickHeader(headers, 'x-forwarded-for')?.split(',')[0]?.trim()
    ?? pickHeader(headers, 'x-real-ip');

  return {
    transport,
    apiKey,
    projectName,
    meta: { ...(meta ?? {}), ip: resolvedIp },
  };
}
