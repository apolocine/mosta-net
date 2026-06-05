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
//   8. Portal Account + Portal ApiKey (B1+B2 multi-tenant β)
//
// NB : les schémas business (Plan/Subscription/Invoice/UsageLog) et le seed
// des plans par défaut sont une concern cloud (Octocloud), pas net (Octonet
// générique). Voir @mostajs/cloud-config et l'instrumentation Octocloud.
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
  /** Portal Account ID — racine de hiérarchie pour les users d'Octocloud (B3 modèle β). */
  portalAccountId?: string | null
  /** Clé publique en clair — uniquement au tout premier bootstrap. null sinon. */
  publicApiKey?:    string | null
  /** Clé portal scopée (pour Octocloud → Octonet) — uniquement au tout premier bootstrap. null sinon. */
  portalApiKey?:    string | null
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
    //
    // On instancie directement les Repository avec le `dialect` reçu — qui
    // est l'orm singleton (= meta DB) après le reset architectural. Les
    // helpers rbac (createAdmin, seedRBAC) marcheraient aussi puisqu'ils
    // passent par data-plug.getDialect() qui retourne ce même singleton.
    // On préfère la version explicite ici pour rester lisible au boot.
    const {
      UserSchema, RoleSchema, PermissionSchema, PermissionCategorySchema, AccountSchema,
      OCTONET_RBAC_SEED,
      UserRepository, RoleRepository, AccountRepository,
      PermissionRepository, PermissionCategoryRepository,
    } = await import('@mostajs/rbac/server')

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

    // Construct repositories bound to OUR dialect (not the global singleton).
    const userRepo    = new UserRepository(dialect)
    const roleRepo    = new RoleRepository(dialect)
    const permRepo    = new PermissionRepository(dialect)
    const catRepo     = new PermissionCategoryRepository(dialect)
    const accountRepo = new AccountRepository(dialect)

    // ── 2. Seed RBAC (idempotent — upsert by name, on OUR dialect) ──
    if (!opts.skipSeed) {
      // 2a. Categories
      for (const cat of OCTONET_RBAC_SEED.categories) {
        await (catRepo as any).upsert({ name: cat.name }, cat)
      }
      // 2b. Permissions — build code→id map for role wiring
      const permissionMap: Record<string, string> = {}
      for (const pDef of OCTONET_RBAC_SEED.permissions) {
        const displayName = pDef.name || pDef.code
        const perm = await (permRepo as any).upsert(
          { name: displayName },
          { name: displayName, description: pDef.description, category: pDef.category },
        )
        permissionMap[pDef.code] = (perm as any).id
      }
      // 2c. Roles — link to permission IDs
      for (const [, roleDef] of Object.entries(OCTONET_RBAC_SEED.roles)) {
        const r = roleDef as { name: string; description?: string; permissions: string[] }
        const permissionIds = r.permissions
          .map((code: string) => permissionMap[code])
          .filter(Boolean)
        await (roleRepo as any).upsert(
          { name: r.name },
          { name: r.name, description: r.description, permissions: permissionIds },
        )
      }
      log(`seeded ${OCTONET_RBAC_SEED.categories.length} categories, ${OCTONET_RBAC_SEED.permissions.length} permissions, ${Object.keys(OCTONET_RBAC_SEED.roles).length} roles`)
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
    // ── Bootstrap data (env-driven, defaults preserved) ──
    // Externalisé pour éviter les magic strings dans le code. Les defaults
    // sont publics par design (apparaissent dans les logs, dans la doc PH).
    const adminRoleName       = getEnv('OCTONET_ADMIN_ROLE_NAME',       'admin')
    const adminUserStatus     = getEnv('OCTONET_ADMIN_USER_STATUS',     'active')
    const adminFirstName      = opts.adminFirstName || getEnv('OCTONET_ADMIN_FIRSTNAME', 'Admin')
    const adminLastName       = opts.adminLastName  || getEnv('OCTONET_ADMIN_LASTNAME',  'Octonet')
    const publicRoleName      = getEnv('OCTONET_PUBLIC_ROLE_NAME',      'public')
    const trialAccountName    = getEnv('OCTONET_TRIAL_ACCOUNT_NAME',    'trial-playground')
    const trialAccountType    = getEnv('OCTONET_TRIAL_ACCOUNT_TYPE',    'trial')
    const trialAccountPlan    = getEnv('OCTONET_TRIAL_ACCOUNT_PLAN',    'trial')
    const trialAccountStatus  = getEnv('OCTONET_TRIAL_ACCOUNT_STATUS',  'active')
    const publicUserEmail     = getEnv('OCTONET_PUBLIC_USER_EMAIL',     'public-demo@octonet.amia.fr')
    const publicUserFirstName = getEnv('OCTONET_PUBLIC_USER_FIRSTNAME', 'Public')
    const publicUserLastName  = getEnv('OCTONET_PUBLIC_USER_LASTNAME',  'Demo')
    const publicUserStatus    = getEnv('OCTONET_PUBLIC_USER_STATUS',    'active')
    const publicAccountName   = getEnv('OCTONET_PUBLIC_ACCOUNT_NAME',   'public-system')
    const publicAccountType   = getEnv('OCTONET_PUBLIC_ACCOUNT_TYPE',   'system')
    const publicAccountPlan   = getEnv('OCTONET_PUBLIC_ACCOUNT_PLAN',   'free')
    const publicAccountStatus = getEnv('OCTONET_PUBLIC_ACCOUNT_STATUS', 'active')

    // Manual createAdmin equivalent — bound to OUR dialect.
    let adminUser = await userRepo.findByEmail(adminEmail.toLowerCase()) as any
    if (!adminUser) {
      adminUser = await userRepo.create({
        email:     adminEmail.toLowerCase(),
        password:  await hashPassword(adminPassword),
        firstName: adminFirstName,
        lastName:  adminLastName,
        status:    adminUserStatus,
      } as any) as any
      const adminRole = await (roleRepo as any).findByName(adminRoleName)
      if (adminRole && adminUser?.id) {
        await userRepo.addRole(adminUser.id, (adminRole as any).id)
      }
    }
    if (!adminUser?.id) {
      return { ok: false, error: 'admin user creation failed' }
    }
    const adminResult = { ok: true as const, userId: adminUser.id, email: adminUser.email }
    log(`admin user: ${adminResult.email} (id=${adminResult.userId})`)

    // ── 4. Trial Account (accountRepo was created above, bound to OUR dialect) ──
    let trialAccount = await accountRepo.findByType(trialAccountType)
    if (!trialAccount) {
      trialAccount = await accountRepo.create({
        name:   trialAccountName,
        type:   trialAccountType,
        plan:   trialAccountPlan,
        status: trialAccountStatus,
        owner:  adminResult.userId,
      } as any)
      log(`trial account created: ${trialAccount.id}`)
    } else {
      log(`trial account exists: ${trialAccount.id}`)
    }

    // ── 5. Public-demo User (userRepo, roleRepo bound to OUR dialect already) ──
    let publicUser = await userRepo.findByEmail(publicUserEmail) as any
    if (!publicUser) {
      const randomPwd = randomBytes(32).toString('hex')
      publicUser = await userRepo.create({
        email:     publicUserEmail,
        password:  await hashPassword(randomPwd),
        firstName: publicUserFirstName,
        lastName:  publicUserLastName,
        status:    publicUserStatus,
      } as any) as any
      // Attach role 'public'
      const publicRole = await (roleRepo as any).findOne({ name: publicRoleName })
      if (publicRole && publicUser?.id) {
        await userRepo.addRole(publicUser.id, (publicRole as any).id)
      }
      log(`public-demo user created: ${publicUser?.id}`)
    } else {
      log(`public-demo user exists: ${publicUser.id}`)
    }

    // ── 6. Public-system Account ──
    let publicAccount = await accountRepo.findOne({ name: publicAccountName, type: publicAccountType })
    if (!publicAccount) {
      publicAccount = await accountRepo.create({
        name:   publicAccountName,
        type:   publicAccountType,
        plan:   publicAccountPlan,
        status: publicAccountStatus,
        owner:  (publicUser as any).id,
      } as any)
      log(`public-system account created: ${publicAccount.id}`)
    } else {
      log(`public-system account exists: ${publicAccount.id}`)
    }

    // ── 7. Public ApiKey scoped to project 'default' (read-only) ──
    const apikeyRepo = getApiKeyRepo(dialect)
    const publicKeyLabel       = opts.publicKeyLabel || getEnv('OCTONET_PUBLIC_APIKEY_LABEL', 'public-default')
    const publicKeyEnv         = (getEnv('OCTONET_PUBLIC_APIKEY_ENV', 'live') as 'live' | 'test')
    const publicKeyProjects    = (getEnv('OCTONET_PUBLIC_APIKEY_PROJECTS', 'default')).split(',').map(s => s.trim()).filter(Boolean)
    const publicKeyOperations  = (getEnv('OCTONET_PUBLIC_APIKEY_OPERATIONS', 'read')).split(',').map(s => s.trim()).filter(Boolean)
    const publicKeyTransports  = (getEnv('OCTONET_PUBLIC_APIKEY_TRANSPORTS', 'rest,mcp')).split(',').map(s => s.trim()).filter(Boolean)
    const existingKey = await apikeyRepo.findOne({
      account: (publicAccount as any).id,
      label:   publicKeyLabel,
      enabled: true,
    } as any)
    let publicApiKey: string | null = null
    if (!existingKey) {
      const generated = generateApiKey(publicKeyEnv)
      await apikeyRepo.create({
        account:    (publicAccount as any).id,
        prefix:     generated.prefix,
        hash:       generated.hash,
        label:      publicKeyLabel,
        permissions: {
          projects:   publicKeyProjects,
          operations: publicKeyOperations,
          transports: publicKeyTransports,
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

    // ── 8. Portal Account dédié (B1) + Portal ApiKey scopée (B2) ──
    //
    // B1 : Octocloud est un TENANT à part entière, pas un user. Il a son propre
    // Account (type='portal'), distinct du compte personnel de l'admin.
    // Cet Account devient la racine de hiérarchie : tous les comptes personnels
    // des users de cet octocloud auront `parent = portal_account.id` (B3 modèle β).
    //
    // B2 : la portal apikey n'a plus les wildcards `* * *` de l'apikey admin.
    // Elle est scopée { projects:'*', operations:[read,write], transports:[rest,mcp] }
    // — pas d'`admin` (endpoints sensibles inaccessibles), transports limités.
    // Si compromise, dégâts limités au tenant + actions non-admin.
    let portalApiKey: string | null = null
    let portalAccountId: string | null = null
    const portalEnabled = getEnvBool('OCTONET_PORTAL_APIKEY_ENABLED', true)
    if (portalEnabled) {
      const portalKeyLabel    = getEnv('OCTONET_PORTAL_APIKEY_LABEL', 'octocloud-portal')
      const portalKeyEnv      = (getEnv('OCTONET_PORTAL_APIKEY_ENV', 'live') as 'live' | 'test')
      const portalAccountName = getEnv('OCTONET_PORTAL_ACCOUNT_NAME', 'octocloud-portal')
      const portalAccountType = getEnv('OCTONET_PORTAL_ACCOUNT_TYPE', 'portal')
      const portalAccountPlan = getEnv('OCTONET_PORTAL_ACCOUNT_PLAN', 'unlimited')
      // Scopes B2 — pas d'admin, transports limités (rest+mcp suffisent au portail).
      const portalKeyOps        = (getEnv('OCTONET_PORTAL_APIKEY_OPERATIONS', 'read,write')).split(',').map(s => s.trim()).filter(Boolean)
      const portalKeyTransports = (getEnv('OCTONET_PORTAL_APIKEY_TRANSPORTS', 'rest,mcp')).split(',').map(s => s.trim()).filter(Boolean)
      const portalKeyProjects   = (getEnv('OCTONET_PORTAL_APIKEY_PROJECTS', '*')).split(',').map(s => s.trim()).filter(Boolean)

      // B1 — récupère ou crée le portal Account dédié.
      let portalAccount = await accountRepo.findOne({ name: portalAccountName, type: portalAccountType } as any)
      if (!portalAccount) {
        portalAccount = await accountRepo.create({
          name:   portalAccountName,
          type:   portalAccountType,
          plan:   portalAccountPlan,
          status: 'active',
          owner:  adminResult.userId,
        } as any)
        log(`portal account created: ${(portalAccount as any).id}`)
      }
      portalAccountId = (portalAccount as any).id

      const existingPortalKey = await apikeyRepo.findOne({
        account: portalAccountId,
        label:   portalKeyLabel,
        enabled: true,
      } as any)
      if (!existingPortalKey) {
        const generated = generateApiKey(portalKeyEnv)
        await apikeyRepo.create({
          account:    portalAccountId,
          prefix:     generated.prefix,
          hash:       generated.hash,
          label:      portalKeyLabel,
          permissions: {
            projects:   portalKeyProjects,    // ['*'] — tous projets côté Octonet
            operations: portalKeyOps,         // ['read','write'] — pas d'admin
            transports: portalKeyTransports,  // ['rest','mcp'] — restreints
          },
          enabled:    true,
          usageCount: 0,
        } as any)
        portalApiKey = generated.full
        console.log(`[rbac-bootstrap] ⚠ portal apikey emitted ONCE → ${generated.full}`)
        console.log(`[rbac-bootstrap] ⚠ paste in Octocloud's MOSTA_NET_API_KEY env var.`)
        console.log(`[rbac-bootstrap] ⚠ portal account id (for OCTONET_PORTAL_ACCOUNT_ID): ${portalAccountId}`)
      } else {
        log(`portal apikey exists (prefix=${(existingPortalKey as any).prefix}) — not regenerating`)
      }
    }

    return {
      ok:              true,
      adminUserId:     adminResult.userId,
      adminEmail:      adminResult.email,
      trialAccountId:  (trialAccount as any).id,
      publicUserId:    (publicUser as any).id,
      publicAccountId: (publicAccount as any).id,
      portalAccountId,
      publicApiKey,
      portalApiKey,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}
