// @mostajs/net — API Key authentication middleware (adapter)
//
// Adapter trivial entre la signature TransportMiddleware d'Octonet et
// le helper agnostique checkApiKey() de @mostajs/api-keys.
//
// Toute la logique de vérification (résolution, scope-checks, touch)
// vit dans @mostajs/api-keys. Ce fichier ne fait que :
//   1. extraire la clé du contexte
//   2. construire les checks selon le contexte de la requête
//   3. appeler checkApiKey(dialect, { rawKey, checks, ip })
//   4. mapper le résultat sur la signature middleware
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import type { TransportMiddleware } from '../core/types.js';
import type { IDialect } from '@mostajs/orm';

/**
 * Map an OrmRequest.op to the coarse 'read' | 'write' | 'admin' family
 * used by the conventional 'operations' scope. Pure mapping — no
 * authorization decision here.
 */
function opToOperation(op: string): 'read' | 'write' | 'admin' {
  if (op === 'findAll' || op === 'findOne' || op === 'findById'
      || op === 'count' || op === 'search' || op === 'aggregate' || op === 'stream') {
    return 'read';
  }
  if (op === 'create' || op === 'update' || op === 'delete' || op === 'upsert'
      || op === 'updateMany' || op === 'addToSet' || op === 'pull' || op === 'increment') {
    return 'write';
  }
  return 'admin';
}

/**
 * Build an API key middleware bound to a metadata dialect.
 *
 * @param getMetaDialect Returns the dialect that hosts api_keys + scopes
 *                       tables. May return null in dev mode (no DB).
 * @param options.openMode If true, requests without a key pass through.
 */
export function createApiKeyMiddleware(
  getMetaDialect: () => IDialect | null | undefined,
  options: { openMode?: boolean } = {},
): TransportMiddleware {
  const { openMode = false } = options;

  return async (req, ctx, next) => {
    const rawKey = ctx.apiKey;

    // No API key in request
    if (!rawKey) {
      if (openMode) return next();
      return {
        status: 'error',
        error: { code: 'UNAUTHORIZED',
          message: 'API key required. Pass it via X-API-Key header (or ?apikey=...)' },
      };
    }

    const dialect = getMetaDialect();
    if (!dialect) {
      // No DB → can't verify. Strict by default.
      if (openMode) return next();
      return {
        status: 'error',
        error: { code: 'UNAUTHORIZED',
          message: 'API key validation unavailable (no metadata DB connected)' },
      };
    }

    try {
      const { checkApiKey } = await import('@mostajs/api-keys/server');

      const result = await checkApiKey(dialect, {
        rawKey,
        checks: [
          { scope: 'projects',   value: ctx.projectName || 'default' },
          { scope: 'operations', value: opToOperation(req.op as string) },
          { scope: 'transports', value: ctx.transport || 'rest' },
        ],
        ip: (ctx.meta?.ip as string) || undefined,
      });

      if (!result.ok) {
        return {
          status: 'error',
          error: { code: result.code || 'UNAUTHORIZED',
            message: result.message || 'API key check failed' },
        };
      }

      // Enrich downstream context
      const apikey = result.apikey as any;
      ctx.subscription       = apikey.label || apikey.id;
      ctx.permissions        = apikey.permissions?.scopes ?? {};
      (ctx as any).accountId = apikey.account || apikey.accountId;
      (ctx as any).apikeyId  = apikey.id;

      return next();
    } catch (e: any) {
      console.warn('[apikey-middleware] check failed:', e?.message || e);
      return {
        status: 'error',
        error: { code: 'UNAUTHORIZED', message: 'API key check error' },
      };
    }
  };
}
