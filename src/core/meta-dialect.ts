// @mostajs/net — Meta dialect loader.
//
// Opens a dedicated DB connection for Octonet metadata (RBAC users, roles,
// accounts, api_keys, scopes, plans, subscriptions). When set, this DB is
// shared with Octocloud (the Next.js portal at octocloud.amia.fr) so that
// an apikey emitted from Octocloud is immediately usable on Octonet.
//
// Resolution order:
//   1. If OCTONET_META_URI is set → open an isolated dialect (separate
//      connection pool, separate URI), inferring the dialect from
//      OCTONET_META_DIALECT or — failing that — the URI scheme.
//   2. Otherwise → reuse the default project's dialect (rétrocompat).
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import { createIsolatedDialect } from '@mostajs/orm'
import type { IDialect, DialectType, ConnectionConfig } from '@mostajs/orm'
import { getEnv, getEnvBool, getEnvNumber } from '@mostajs/config'

/** Map a connection URI scheme to a known dialect name. */
function inferDialectFromUri(uri: string): DialectType | null {
  if (!uri) return null
  if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) return 'postgres'
  if (uri.startsWith('mysql://')) return 'mysql'
  if (uri.startsWith('mariadb://')) return 'mariadb'
  if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) return 'mongodb'
  if (uri.startsWith('sqlserver://') || uri.startsWith('mssql://')) return 'mssql'
  if (uri.startsWith('oracle://')) return 'oracle'
  if (uri.startsWith('db2://')) return 'db2'
  if (uri.startsWith('hana://')) return 'hana'
  if (uri.startsWith('hsqldb://')) return 'hsqldb'
  if (uri.startsWith('cockroachdb://') || uri.startsWith('crdb://')) return 'cockroachdb'
  if (uri.startsWith('spanner://')) return 'spanner'
  if (uri.startsWith('sybase://')) return 'sybase'
  if (uri === ':memory:' || uri.endsWith('.sqlite') || uri.endsWith('.db')) return 'sqlite'
  return null
}

/**
 * Resolve the metadata dialect.
 *
 * @param defaultDialect The dialect of the default project (rétrocompat fallback).
 * @returns A connected dialect dedicated to RBAC + ApiKey tables, or the
 *          default dialect if OCTONET_META_URI is not configured.
 */
export async function resolveMetaDialect(
  defaultDialect: IDialect | null,
): Promise<{ dialect: IDialect | null; isolated: boolean; uri?: string }> {
  const metaUri = getEnv('OCTONET_META_URI')
  if (!metaUri) {
    return { dialect: defaultDialect, isolated: false }
  }

  // Skip if same URI as default — saves a redundant pool.
  const defaultUri = getEnv('SGBD_URI')
  if (metaUri === defaultUri) {
    return { dialect: defaultDialect, isolated: false }
  }

  const explicit = getEnv('OCTONET_META_DIALECT') as DialectType | undefined
  const inferred = inferDialectFromUri(metaUri)
  const dialect = explicit || inferred
  if (!dialect) {
    throw new Error(
      `OCTONET_META_URI is set but the dialect could not be inferred from the URI scheme. ` +
      `Set OCTONET_META_DIALECT explicitly (e.g. postgres, mongodb, sqlite).`,
    )
  }

  const cfg: ConnectionConfig = {
    dialect,
    uri: metaUri,
    showSql:        getEnvBool('OCTONET_META_SHOW_SQL', false),
    schemaStrategy: (getEnv('OCTONET_META_SCHEMA_STRATEGY', 'update')) as ConnectionConfig['schemaStrategy'],
    poolSize:       getEnvNumber('OCTONET_META_POOL_SIZE', 5),
  }

  const meta = await createIsolatedDialect(cfg, [])
  return { dialect: meta, isolated: true, uri: metaUri }
}
