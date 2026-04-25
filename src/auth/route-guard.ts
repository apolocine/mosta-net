// @mostajs/net — Fastify route guard adapter.
//
// Thin wrapper around `checkRequest()` from `@mostajs/auth/server`. Le
// helper agnostique vit dans `mosta-auth` ; ici on ne fait que mapper
// l'objet `FastifyRequest` vers le format attendu par checkRequest.
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import type { IDialect } from '@mostajs/orm'

export interface AuthGuardParams {
  /** Transport name — 'rest' | 'jsonrpc' | 'mcp' | 'sse' | 'trpc' | 'odata' | 'graphql' | 'ws' */
  transport: string
  /** Operation family — read / write / admin (omit if you don't want to enforce) */
  operation?: 'read' | 'write' | 'admin'
  /** Allow request through without apikey (legacy / public-mode) */
  openMode?: boolean
  /** Default project slug when not specified in headers */
  defaultProject?: string
  /** When no apikey, fall back to a labeled apikey (typ. 'public-default'). */
  fallbackPublicLabel?: string
}

export interface AuthGuardResult {
  ok: boolean
  ctx?: any
  status?: number
  body?: any
}

/**
 * Apply auth check on an incoming Fastify request. Use in route handlers :
 *
 *   const auth = await authGuard(dialect, req, { transport: 'jsonrpc' });
 *   if (!auth.ok) { reply.code(auth.status!); return auth.body; }
 *   // … use auth.ctx (apiKey, projectName, accountId, apikeyId, …)
 */
export async function authGuard(
  dialect: IDialect | null | undefined,
  req: any,
  params: AuthGuardParams,
): Promise<AuthGuardResult> {
  // Sub-path import bypasses the auth server barrel which transitively loads
  // next-auth / next types — Octonet (Fastify) doesn't have those.
  const { checkRequest } = await import('@mostajs/auth/lib/check-request')

  const result = await checkRequest({
    dialect,
    headers:   req?.headers,
    query:     req?.query,
    ip:        req?.ip,
    transport: params.transport,
    openMode:  params.openMode,
    fallbackPublicLabel: params.fallbackPublicLabel,
    checks: [
      { scope: 'projects',   value: params.defaultProject || 'default' },
      { scope: 'transports', value: params.transport },
      ...(params.operation ? [{ scope: 'operations', value: params.operation }] : []),
    ],
  })

  return {
    ok:     result.ok,
    ctx:    result.ctx,
    status: result.status,
    body:   result.body,
  }
}
