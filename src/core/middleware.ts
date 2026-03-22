// @mostajs/net — Middleware pipeline
// Composes middleware functions (auth, rate-limit, logging) into a chain
// Author: Dr Hamid MADANI drmdh@msn.com

import type { OrmRequest, OrmResponse } from '@mostajs/orm';
import type { TransportMiddleware, TransportContext } from './types.js';

/**
 * Compose an array of middlewares into a single execution chain.
 * Each middleware calls next() to pass to the next one.
 * The last function in the chain executes the actual ORM operation.
 */
export function composeMiddleware(
  middlewares: TransportMiddleware[],
  handler: (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>,
): (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse> {
  return async (req: OrmRequest, ctx: TransportContext): Promise<OrmResponse> => {
    let index = 0;

    const next = async (): Promise<OrmResponse> => {
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        return mw(req, ctx, next);
      }
      return handler(req, ctx);
    };

    return next();
  };
}

/**
 * Logging middleware — logs every request/response.
 */
export const loggingMiddleware: TransportMiddleware = async (req, ctx, next) => {
  const start = Date.now();
  const res = await next();
  const ms = Date.now() - start;
  const status = res.status === 'ok' ? '\x1b[32mOK\x1b[0m' : '\x1b[31mERR\x1b[0m';
  console.log(`[${ctx.transport}] ${req.op} ${req.entity}${req.id ? '/' + req.id : ''} → ${status} (${ms}ms)`);
  return res;
};
