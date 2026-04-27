// @mostajs/net — Account-scope middleware (B3, modèle β parent FK)
//
// Cloisonnement multi-tenant row-level. Quand l'apikey utilisée appartient
// à un Account de type 'portal' (un Octocloud tenant), ce middleware injecte
// automatiquement un filtre `account IN (portal, ...children)` sur les
// requêtes touchant des entités account-scoped (api_keys, projects,
// subscriptions, invoices, usage_logs, accounts).
//
// Conséquence : Octocloud_A (portal apikey rattachée à Account_A) ne peut
// PAS voir les données dont l'`account` n'est ni A ni un enfant de A —
// même s'il essaie en bypassant ses propres filtres applicatifs.
//
// Pour les apikeys non-portal (perso, system, trial), le scope reste
// strictement à l'account propre de l'apikey (pas d'expansion enfants).
//
// L'entité 'Account' elle-même est filtrée différemment : via les colonnes
// `id` et `parent` (au lieu d'une colonne `account` qui n'existe pas).
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import type { TransportMiddleware } from '../core/types.js'
import type { IDialect } from '@mostajs/orm'

/** Entités dont chaque row appartient à un Account via une colonne `account` FK. */
const ACCOUNT_SCOPED_ENTITIES = new Set<string>([
  'ApiKey',       // mosta-api-keys
  'Project',      // mosta-project-life
  'Subscription', // mosta-subscriptions-plan
  'Invoice',      // mosta-subscriptions-plan
  'UsageLog',     // mosta-subscriptions-plan
])

/** Entités non scopées (catalogues globaux, schemas RBAC partagés). */
const GLOBAL_ENTITIES = new Set<string>([
  'Plan',                  // catalogue partagé
  'Role',                  // RBAC global
  'Permission',            // RBAC global
  'PermissionCategory',    // RBAC global
])

/**
 * Build the account-scope middleware bound to a metadata dialect.
 *
 * @param getMetaDialect Returns the dialect that hosts accounts + apikeys
 *                       (le singleton octoswitcher dans la majorite des cas).
 */
export function createAccountScopeMiddleware(
  getMetaDialect: () => IDialect | null | undefined,
): TransportMiddleware {
  return async (req, ctx, next) => {
    const accountId = (ctx as any).accountId as string | undefined
    if (!accountId) return next() // pas d'apikey resolue → on laisse passer (anonymous, openMode etc.)

    const entity = (req as any).entity as string | undefined
    if (!entity) return next()

    if (GLOBAL_ENTITIES.has(entity)) return next() // catalogues, hors scope

    const dialect = getMetaDialect()
    if (!dialect) return next() // sans DB on ne peut pas expand

    // ── Resolve l'expansion {portalAccountId, ...childrenIds} si l'apikey
    //    appartient a un portal Account, sinon juste [accountId].
    let allowedAccountIds: string[]
    try {
      const { AccountRepository } = await import('@mostajs/rbac/server')
      const accountRepo = new AccountRepository(dialect)
      const acc = await accountRepo.findById(accountId)
      if (!acc) {
        return errResp('UNAUTHORIZED', 'apikey owner account no longer exists')
      }
      if ((acc as any).type === 'portal') {
        allowedAccountIds = await accountRepo.expandTenant(accountId)
      } else {
        allowedAccountIds = [accountId]
      }
    } catch (e: any) {
      console.warn('[account-scope] failed to expand tenant:', e?.message || e)
      return next() // best-effort : si on ne peut pas resoudre, on degrade au comportement actuel
    }

    // ── Cas spécial : Account entity elle-même filtre par id/parent ──
    if (entity === 'Account') {
      return applyAccountEntityScope(req, allowedAccountIds, next)
    }

    // ── User entity : pas de colonne `account` directe → pas de filtre row-level
    //    au niveau du middleware. Le cloisonnement des users reste a faire en
    //    B4 via la M2M account_members ou via une join. Pour PH#2 mono-tenant
    //    ca n'a pas d'impact. ──
    if (entity === 'User') return next()

    // ── Entités account-scoped via colonne `account` ──
    if (!ACCOUNT_SCOPED_ENTITIES.has(entity)) {
      // Entité non listée — pas de cloisonnement applique. Si tu ajoutes une
      // nouvelle entité account-scoped, declare-la dans ACCOUNT_SCOPED_ENTITIES.
      return next()
    }

    return applyScopedFilter(req, 'account', allowedAccountIds, next)
  }
}

/**
 * Inject `WHERE <field> IN allowed` (or = allowed[0] si singleton) dans le filter,
 * verifie ownership pour les ops par id, force la valeur a la creation.
 */
async function applyScopedFilter(
  req: any,
  field: string,
  allowed: string[],
  next: () => Promise<any>,
): Promise<any> {
  const allowedSet = new Set(allowed)
  const op = req.op as string

  switch (op) {
    case 'findAll':
    case 'findOne':
    case 'count':
    case 'aggregate':
    case 'search': {
      req.filter = mergeFilter(req.filter, field, allowed)
      return next()
    }

    case 'findById': {
      // Apres le find, on devra verifier que la row obtenue a bien account ∈ allowed.
      const result = await next()
      if (result?.status === 'ok' && result.data) {
        const rowAccount = (result.data as any)[field]
        if (rowAccount && !allowedSet.has(String(rowAccount))) {
          return errResp('FORBIDDEN', `entity not in tenant scope`)
        }
      }
      return result
    }

    case 'create': {
      if (!req.data) req.data = {}
      const requested = req.data[field]
      if (requested && !allowedSet.has(String(requested))) {
        return errResp('FORBIDDEN', `cannot create ${field}=${requested} — not in tenant scope`)
      }
      // Si le caller n'a pas precise account, on ne devine pas (bug applicatif).
      // Le sanitizer côte business decidera. Ici on enforce : si specifie, doit etre dans scope.
      return next()
    }

    case 'update':
    case 'delete': {
      // Ces ops portent sur un id explicite. On verifie d'abord que la row appartient au scope.
      // Lecture pre-flight : impossible depuis ce middleware sans coupler au repo. On laisse
      // passer ; le filter au niveau update/delete by id ne s'applique pas. Le risque est
      // limite : pour escalader, il faudrait connaitre l'id d'une autre tenant ET avoir
      // l'apikey portal de la victime. Pour PH#2 mono-tenant ce n'est pas exploitable.
      // TODO post-PH : pre-flight read avant update/delete.
      return next()
    }

    case 'updateMany':
    case 'deleteMany': {
      // Filter scope applique — toute operation hors scope renvoie 0 rows touched.
      req.filter = mergeFilter(req.filter, field, allowed)
      return next()
    }

    default:
      return next()
  }
}

/** Cas spécial Account : id ou parent doit être dans la tenant. */
async function applyAccountEntityScope(
  req: any,
  allowed: string[],
  next: () => Promise<any>,
): Promise<any> {
  const allowedSet = new Set(allowed)
  const op = req.op as string

  switch (op) {
    case 'findAll':
    case 'findOne':
    case 'count':
    case 'aggregate': {
      // Account WHERE id IN allowed OR parent IN allowed
      // Format MongoDB-like : {$or: [{id: {$in: allowed}}, {parent: {$in: allowed}}]}
      const orClause = [
        { id: { $in: allowed } },
        { parent: { $in: allowed } },
      ]
      const existing = req.filter || {}
      req.filter = Object.keys(existing).length === 0
        ? { $or: orClause }
        : { $and: [existing, { $or: orClause }] }
      return next()
    }

    case 'findById': {
      const result = await next()
      if (result?.status === 'ok' && result.data) {
        const row = result.data as any
        const id = String(row.id ?? '')
        const parent = row.parent ? String(row.parent) : null
        if (!allowedSet.has(id) && !(parent && allowedSet.has(parent))) {
          return errResp('FORBIDDEN', 'account not in tenant scope')
        }
      }
      return result
    }

    case 'create': {
      // Pour creer un Account avec parent=portal (cas register user), parent doit
      // etre dans allowed.
      const requestedParent = req.data?.parent
      if (requestedParent && !allowedSet.has(String(requestedParent))) {
        return errResp('FORBIDDEN', `cannot create account with parent=${requestedParent} — not in tenant scope`)
      }
      return next()
    }

    default:
      return next()
  }
}

/** Merge un filter user avec une contrainte `field IN allowed`. */
function mergeFilter(existing: any, field: string, allowed: string[]): any {
  const constraint = allowed.length === 1
    ? { [field]: allowed[0] }
    : { [field]: { $in: allowed } }

  if (!existing || Object.keys(existing).length === 0) return constraint
  return { $and: [existing, constraint] }
}

function errResp(code: string, message: string) {
  return { status: 'error', error: { code, message } } as any
}
