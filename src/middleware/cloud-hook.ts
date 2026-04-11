// Author: Dr Hamid MADANI drmdh@msn.com
// @mostajs/net — Cloud middleware hook point

/**
 * Cloud middleware hook for @mostajs/net.
 * Allows injecting @mostajs/cloud-middleware before ormHandler.
 *
 * Usage in server.ts:
 *   const { cloudHook } = await import('./middleware/cloud-hook.js')
 *   cloudHook.setMiddleware(myCloudMiddleware)
 *   // Then in ormHandler: if (cloudHook.isEnabled()) { await cloudHook.process(req) }
 */

export type CloudMiddlewareFn = (
  rawKey: string | undefined,
  projectSlug: string,
  transport: string,
  method: string,
  body?: any,
  ip?: string,
) => Promise<{ passed: boolean; response?: any; context?: any }>

let middleware: CloudMiddlewareFn | null = null
let enabled = false

export const cloudHook = {
  /** Set the cloud middleware function */
  setMiddleware(fn: CloudMiddlewareFn): void {
    middleware = fn
    enabled = true
  },

  /** Remove the cloud middleware */
  removeMiddleware(): void {
    middleware = null
    enabled = false
  },

  /** Check if cloud middleware is active */
  isEnabled(): boolean {
    return enabled && middleware !== null
  },

  /** Process a request through the cloud middleware */
  async process(
    rawKey: string | undefined,
    projectSlug: string,
    transport: string,
    method: string,
    body?: any,
    ip?: string,
  ): Promise<{ passed: boolean; response?: any; context?: any }> {
    if (!middleware) return { passed: true }
    return middleware(rawKey, projectSlug, transport, method, body, ip)
  },

  /** Get current middleware (for testing) */
  getMiddleware(): CloudMiddlewareFn | null {
    return middleware
  },
}
