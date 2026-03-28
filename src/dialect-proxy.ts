// NetDialectProxy — Fake IDialect that translates every call to NetClient HTTP
// Injected into existing repositories so they work in NET mode without modification
// Lives in @mostajs/net (NOT in ORM) — ORM doesn't know about NET
// Author: Dr Hamid MADANI drmdh@msn.com

import type { NetClient } from './client.js'

/**
 * Creates a proxy object that implements IDialect by delegating to NetClient.
 * Repositories (BaseRepository) call dialect.findOne(), dialect.create(), etc.
 * This proxy translates those calls to HTTP requests via NetClient.
 *
 * Usage:
 *   import { NetClient, createNetDialectProxy } from '@mostajs/net/client'
 *   const client = new NetClient({ url: 'http://localhost:14488' })
 *   const dialect = createNetDialectProxy(client)
 *   const repo = new UserRepository(dialect)  // works like ORM mode
 */
export function createNetDialectProxy(client: NetClient): any {
  const schemas: any[] = []

  return {
    // ── Property ──────────────────────────────────────
    dialectType: 'net-proxy',

    // ── Lifecycle ─────────────────────────────────────
    connect: async () => {},
    disconnect: async () => {},
    testConnection: () => client.health(),
    initSchema: async (s: any[]) => { schemas.push(...s) },

    // ── CRUD ──────────────────────────────────────────

    find: (schema: any, filter: any, options?: any) =>
      client.findAll(schema.collection, filter, options),

    findOne: (schema: any, filter: any, _options?: any) =>
      client.findOne(schema.collection, filter),

    findById: (schema: any, id: string, _options?: any) =>
      client.findById(schema.collection, id),

    create: async (schema: any, data: any) => {
      const result = await client.create(schema.collection, data)
      return result
    },

    update: async (schema: any, id: string, data: any) => {
      const result = await client.update(schema.collection, id, data)
      return result
    },

    updateMany: (schema: any, filter: any, data: any) =>
      client.updateMany(schema.collection, filter, data),

    delete: (schema: any, id: string) =>
      client.delete(schema.collection, id),

    deleteMany: (schema: any, filter: any) =>
      client.deleteMany(schema.collection, filter),

    // ── Queries ───────────────────────────────────────

    count: (schema: any, filter: any) =>
      client.count(schema.collection, filter),

    distinct: async (schema: any, field: string, filter: any) => {
      const rows = await client.findAll(schema.collection, filter || {})
      return [...new Set((rows as any[]).map(r => r[field]).filter(Boolean))]
    },

    aggregate: (schema: any, stages: any[]) =>
      client.aggregate(schema.collection, stages),

    // ── Relations ─────────────────────────────────────

    findWithRelations: (schema: any, filter: any, relations: string[], options?: any) =>
      client.findWithRelations(schema.collection, filter, relations, options),

    findByIdWithRelations: (schema: any, id: string, relations: string[], _options?: any) =>
      client.findByIdWithRelations(schema.collection, id, relations),

    // ── Upsert ────────────────────────────────────────

    upsert: (schema: any, filter: any, data: any) =>
      client.upsert(schema.collection, filter, data),

    // ── Atomic ────────────────────────────────────────

    increment: (schema: any, id: string, field: string, amount: number) =>
      client.increment(schema.collection, id, field, amount),

    addToSet: (schema: any, id: string, field: string, value: unknown) =>
      client.addToSet(schema.collection, id, field, value),

    pull: (schema: any, id: string, field: string, value: unknown) =>
      client.pull(schema.collection, id, field, value),

    // ── Search ────────────────────────────────────────

    search: (schema: any, query: string, fields: string[], options?: any) =>
      client.search(schema.collection, query, fields, options),
  }
}
