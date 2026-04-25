// @mostajs/net — Response sanitizer middleware
//
// Strips sensitive fields from response payloads. By default removes the
// 'password' field on any data shape. Configurable to extend to other
// fields (resetToken, verifyToken, hash, secret, ...).
//
// Mounted AFTER the route handler runs : the handler returns its raw
// response, this middleware prunes the JSON before it reaches the wire.
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import type { TransportMiddleware } from '../core/types.js';

const DEFAULT_SENSITIVE_FIELDS = [
  'password', 'hash', 'passwordHash',
  'verifyToken', 'verifyTokenExpiresAt',
  'resetToken', 'resetTokenExpiresAt',
  'apiKeyHash', 'secret', 'privateKey',
];

function stripFields(value: any, fields: Set<string>): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => stripFields(v, fields));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) {
      if (fields.has(k)) continue;
      out[k] = stripFields(value[k], fields);
    }
    return out;
  }
  return value;
}

export function createSanitizerMiddleware(
  options: { extraFields?: string[]; disabledForRoles?: string[] } = {},
): TransportMiddleware {
  const fields = new Set([...DEFAULT_SENSITIVE_FIELDS, ...(options.extraFields ?? [])]);

  return async (_req, _ctx, next) => {
    const resp = await next();
    if (resp && typeof resp === 'object' && 'data' in resp) {
      (resp as any).data = stripFields((resp as any).data, fields);
    }
    return resp;
  };
}
