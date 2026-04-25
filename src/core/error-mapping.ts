// @mostajs/net — Map ORM/auth error codes to HTTP status codes.
// Centralisé : tous les sites (REST, project routes, transports) l'utilisent.
// Author: Dr Hamid MADANI <drmdh@msn.com>

export function errorCodeToHttpStatus(code?: string): number {
  if (!code) return 500;

  switch (code) {
    // Auth (mosta-auth / api-keys)
    case 'UNAUTHORIZED':       return 401;
    case 'FORBIDDEN':          return 403;
    case 'UNAVAILABLE':        return 503;
    case 'AUTH_ERROR':         return 500;

    // ORM resource lookup
    case 'ENTITY_NOT_FOUND':
    case 'EntityNotFoundError':
    case 'UNKNOWN_ENTITY':
    case 'NOT_FOUND':          return 404;

    // ORM payload validation
    case 'ValidationError':    return 422;

    // ORM connectivity / config
    case 'DB_NOT_CONNECTED':
    case 'ConnectionError':    return 503;

    // Cloud middleware rejection
    case 'CLOUD_REJECTED':     return 403;

    default:
      // Heuristics for code families
      if (code.startsWith('MISSING')) return 400;
      if (code === 'NO_HANDLER')     return 503;
      return 500;
  }
}
