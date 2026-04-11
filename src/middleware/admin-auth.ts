// Author: Dr Hamid MADANI drmdh@msn.com
// @mostajs/net — Admin authentication (Basic Auth + API key)

export interface AdminAuthConfig {
  /** Basic auth credentials (existing) */
  username?: string
  password?: string
  /** API key verification function (from @mostajs/api-keys) */
  verifyApiKey?: (rawKey: string) => Promise<boolean>
  /** Required permission for admin access */
  adminPermission?: string
}

/**
 * Create admin auth checker that supports both Basic Auth and API key.
 */
export function createAdminAuth(config: AdminAuthConfig) {
  return async function checkAdminAuth(req: any): Promise<{ authorized: boolean; method: 'basic' | 'apikey' | 'none'; error?: string }> {
    // Try API key first (X-Api-Key header)
    const apiKey = req.headers?.['x-api-key']
    if (apiKey && config.verifyApiKey) {
      const valid = await config.verifyApiKey(apiKey)
      if (valid) return { authorized: true, method: 'apikey' }
      return { authorized: false, method: 'apikey', error: 'Invalid API key' }
    }

    // Fallback to Basic Auth
    const auth = req.headers?.authorization
    if (auth?.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString()
      const [user, pass] = decoded.split(':')
      if (user === config.username && pass === config.password) {
        return { authorized: true, method: 'basic' }
      }
      return { authorized: false, method: 'basic', error: 'Invalid credentials' }
    }

    return { authorized: false, method: 'none', error: 'Authentication required' }
  }
}
