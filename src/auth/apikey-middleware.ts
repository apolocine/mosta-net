// @mostajs/net — API Key authentication middleware
// Validates Bearer token against .mosta/apikeys.json
// Checks permissions against the 3D matrix (API key × SGBD × transport)
// Author: Dr Hamid MADANI drmdh@msn.com

import type { TransportMiddleware } from '../core/types.js';
import { validateApiKey, checkPermission, opToPermission } from './apikeys.js';
import { getCurrentDialectType } from '@mostajs/orm';

/**
 * API key authentication middleware.
 *
 * Extracts the API key from:
 *   - Header: Authorization: Bearer msk_live_...
 *   - Query: ?apikey=msk_live_...
 *
 * If .mosta/apikeys.json has no subscriptions, all requests are allowed (open mode).
 * If subscriptions exist, a valid API key is required.
 */
export const apiKeyMiddleware: TransportMiddleware = async (req, ctx, next) => {
  const key = ctx.apiKey;

  // If no key provided, check if we're in open mode (no subscriptions configured)
  if (!key) {
    const { readApiKeys } = await import('./apikeys.js');
    const data = readApiKeys();
    if (data.subscriptions.length === 0) {
      // Open mode: no API keys configured, allow everything
      return next();
    }
    return {
      status: 'error',
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key required. Pass it via Authorization: Bearer <key> header',
      },
    };
  }

  // Validate key
  const sub = validateApiKey(key);
  if (!sub) {
    return {
      status: 'error',
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or revoked API key',
      },
    };
  }

  // Check permission: dialect × transport × operation
  const dialect = getCurrentDialectType();
  const perm = opToPermission(req.op);
  if (!checkPermission(sub, dialect, ctx.transport, perm)) {
    return {
      status: 'error',
      error: {
        code: 'FORBIDDEN',
        message: `Subscription "${sub.name}" does not have ${perm} permission for ${dialect}/${ctx.transport}`,
      },
    };
  }

  // Enrich context
  ctx.subscription = sub.name;
  ctx.permissions = sub.permissions[dialect] || sub.permissions['*'] || {};

  return next();
};
