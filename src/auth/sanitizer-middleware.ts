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

/** Préserve les types qui sont des `object` mais NON-plain — un strip naïf
 *  par `Object.keys` les écrase en `{}` (cas notable : `Date`, `RegExp`,
 *  `Buffer`, `ObjectId` BSON, `Map`/`Set`). Les laisser passer tels quels
 *  donne la sérialisation JSON correcte côté Fastify (Date.toJSON → ISO, etc.). */
function isNonPlainObject(value: any): boolean {
  if (value instanceof Date) return true;
  if (value instanceof RegExp) return true;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(value)) return true;
  if (value instanceof Map || value instanceof Set) return true;
  // BSON ObjectId (Mongo) — duck-type sans require BSON.
  if (value && typeof value === 'object'
      && typeof (value as any)._bsontype === 'string'
      && (value as any)._bsontype === 'ObjectId') return true;
  return false;
}

function stripFields(value: any, fields: Set<string>): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => stripFields(v, fields));
  if (typeof value === 'object') {
    if (isNonPlainObject(value)) return value;
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
