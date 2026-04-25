// @mostajs/net — Bootstrap RBAC + tenancy au démarrage du serveur Octonet.
//
// Idempotent : sans danger d'appel répété à chaque boot. Seul le tout premier
// boot émet l'apikey publique en clair (logs serveur uniquement).
//
// Au programme :
//   1. Enregistrement des schémas RBAC + Account + ApiKey via @mostajs/orm
//   2. seedRBAC(OCTONET_RBAC_SEED) — catégories, permissions, 4 rôles
//   3. createAdmin() depuis .env (OCTONET_ADMIN_EMAIL / OCTONET_ADMIN_PASSWORD)
//   4. Account "trial-playground" (type='trial', owner=admin) — pour le tier T1
//   5. User "public-demo" + role 'public'
//   6. Account "public-system" (type='system', owner=public-demo)
//   7. ApiKey publique scopée projet 'default' (read-only, REST + MCP)
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import { randomBytes } from 'node:crypto'
import { registerSchemas } from '@mostajs/orm'
import type { IDialect } from '@mostajs/orm'
import { getEnv, getEnvBool } from '@mostajs/config'

export interface BootstrapRbacOptions {
  /** Admin credentials — required at first boot, ignored after. */
  adminEmail?:    string
  adminPassword?: string
  adminFirstName?: string
  adminLastName?:  string
  /** Override the public-demo apikey label (default: 'public-default') */
  publicKeyLabel?: string
  /** Skip the RBAC seed phase (re-running seedRBAC is idempotent but slow). */
  skipSeed?: boolean
  /** Verbose logging */
  verbose?: boolean
}

export interface BootstrapRbacResult {
  ok: boolean
  adminUserId?:     string
  adminEmail?:      string
  trialAccountId?:  string
  publicUserId?:    string
  publicAccountId?: string
  /** Clé publique en clair — uniquement au tout premier bootstrap. null sinon. */
  publicApiKey?:    string | null
  error?: string
}

/**
 * Bootstrap RBAC + accounts + public demo apikey on the default project's DB.
 *
 * @param dialect The dialect of the project that hosts Octonet metadata
 *                (typically the project named 'default').
 * @param opts    Admin credentials and overrides.
 */
export async function bootstrapRbac(
  dialect: IDialect,
  opts: BootstrapRbacOptions = {},
): Promise<BootstrapRbacResult> {
  const log = opts.verbose ? (m: string) => console.log(`[rbac-bootstrap] ${m}`) : () => {}

  try {
    // ── Lazy-load all dependencies (avoid hard peer-dep at module-load) ──
    // Everything from '/server' so we don't pull in the UI barrel (lucide-react etc.)
    const {
      UserSchema, RoleSchema, PermissionSchema, PermissionCategorySchema, AccountSchema,
      seedRBAC, createAdmin, OCTONET_RBAC_SEED,
      UserRepository, RoleRepository, AccountRepository,
    } = await import('@mostajs/rbac/server')
    //const { hashPassword } = await import('@mostajs/auth/server')   
    
    const { hashPassword } = await import('@mostajs/auth/lib/password')
    const { ApiKeySchema } = await import('@mostajs/api-keys')
    const { generateApiKey, getApiKeyRepo } = await import('@mostajs/api-keys/server')

    // ── 1. Register schemas in the ORM registry + ensure tables exist ──
    const rbacSchemas = [
      UserSchema, RoleSchema, PermissionSchema, PermissionCategorySchema,
      AccountSchema, ApiKeySchema,
    ]
    registerSchemas(rbacSchemas)
    if (typeof (dialect as any).initSchema === 'function') {
      await (dialect as any).initSchema(rbacSchemas)
    }
    log('schemas registered + tables ensured')

    // ── 2. Seed RBAC (idempotent — upsert by name) ──
    if (!opts.skipSeed) {
      const r = await seedRBAC(OCTONET_RBAC_SEED)
      log(`seeded ${r.categoryCount} categories, ${r.permissionCount} permissions, ${r.roleCount} roles`)
    }

    // ── 3. Admin user (env vars resolved via @mostajs/config — supports profile cascade) ──
    const adminEmail    = opts.adminEmail    || getEnv('OCTONET_ADMIN_EMAIL')
    const adminPassword = opts.adminPassword || getEnv('OCTONET_ADMIN_PASSWORD')
    if (!adminEmail || !adminPassword) {
      return {
        ok: false,
        error: 'OCTONET_ADMIN_EMAIL and OCTONET_ADMIN_PASSWORD required at first bootstrap (or pass via opts)',
      }
    }
    const adminResult = await createAdmin({
      email:     adminEmail,
      password:  adminPassword,
      firstName: opts.adminFirstName || getEnv('OCTONET_ADMIN_FIRSTNAME', 'Admin'),
      lastName:  opts.adminLastName  || getEnv('OCTONET_ADMIN_LASTNAME',  'Octonet'),
      roleName:  'admin',
    })
    if (!adminResult.ok || !adminResult.userId) {
      return { ok: false, error: `createAdmin failed: ${adminResult.error || 'unknown'}` }
    }
    log(`admin user: ${adminResult.email} (id=${adminResult.userId})`)

    // ── 4. Trial Account ──
    const accountRepo = new AccountRepository(dialect)
    let trialAccount = await accountRepo.findByType('trial')
    if (!trialAccount) {
      trialAccount = await accountRepo.create({
        name:   'trial-playground',
        type:   'trial',
        plan:   'trial',
        status: 'active',
        owner:  adminResult.userId,
      } as any)
      log(`trial account created: ${trialAccount.id}`)
    } else {
      log(`trial account exists: ${trialAccount.id}`)
    }

    // ── 5. Public-demo User ──
    const userRepo = new UserRepository(dialect)
    const publicEmail = 'public-demo@octonet.amia.fr'
    let publicUser = await userRepo.findByEmail(publicEmail)
    if (!publicUser) {
      const randomPwd = randomBytes(32).toString('hex')
      publicUser = await userRepo.create({
        email:     publicEmail,
        password:  await hashPassword(randomPwd),
        firstName: 'Public',
        lastName:  'Demo',
        status:    'active',
      } as any)
      // Attach role 'public'
      const roleRepo = new RoleRepository(dialect)
      const publicRole = await roleRepo.findOne({ name: 'public' })
      if (publicRole && (publicUser as any).id) {
        await userRepo.addRole((publicUser as any).id, (publicRole as any).id)
      }
      log(`public-demo user created: ${(publicUser as any).id}`)
    } else {
      log(`public-demo user exists: ${(publicUser as any).id}`)
    }

    // ── 6. Public-system Account ──
    let publicAccount = await accountRepo.findOne({ name: 'public-system', type: 'system' })
    if (!publicAccount) {
      publicAccount = await accountRepo.create({
        name:   'public-system',
        type:   'system',
        plan:   'free',
        status: 'active',
        owner:  (publicUser as any).id,
      } as any)
      log(`public-system account created: ${publicAccount.id}`)
    } else {
      log(`public-system account exists: ${publicAccount.id}`)
    }

    // ── 7. Public ApiKey scoped to project 'default' (read-only) ──
    const apikeyRepo = getApiKeyRepo(dialect)
    const publicKeyLabel = opts.publicKeyLabel || 'public-default'
    const existingKey = await apikeyRepo.findOne({
      account: (publicAccount as any).id,
      label:   publicKeyLabel,
      enabled: true,
    } as any)
    let publicApiKey: string | null = null
    if (!existingKey) {
      const generated = generateApiKey('live')
      await apikeyRepo.create({
        account:    (publicAccount as any).id,
        prefix:     generated.prefix,
        hash:       generated.hash,
        label:      publicKeyLabel,
        permissions: {
          projects:   ['default'],
          operations: ['read'],
          transports: ['rest', 'mcp'],
        },
        enabled:    true,
        usageCount: 0,
      } as any)
      publicApiKey = generated.full
      console.log(`[rbac-bootstrap] ⚠ public demo apikey emitted ONCE → ${generated.full}`)
      console.log(`[rbac-bootstrap] ⚠ store it in your docs / mcp.so listing — never re-derivable.`)
    } else {
      log(`public apikey exists (prefix=${(existingKey as any).prefix}) — not regenerating`)
    }

    return {
      ok:              true,
      adminUserId:     adminResult.userId,
      adminEmail:      adminResult.email,
      trialAccountId:  (trialAccount as any).id,
      publicUserId:    (publicUser as any).id,
      publicAccountId: (publicAccount as any).id,
      publicApiKey,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}
