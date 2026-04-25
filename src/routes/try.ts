// @mostajs/net — T1 sandbox endpoint /try
//
// Provisionne en 2 clics :
//   - User (role 'trial')
//   - Account partagé 'trial-playground'
//   - Project SQLite sandbox isolé (./data/trials/<alias>.sqlite)
//   - ApiKey scopée (rest+mcp, read+write, sandbox-<alias>, TTL 7j)
//
// Anti-abus : rate-limit en mémoire par IP (10 créations / heure).
// Cleanup : job horaire qui supprime User+Project+ApiKey+fichier SQLite
// pour les sandboxes inactives (lastUsedAt < now - 7j).
//
// Author: Dr Hamid MADANI <drmdh@msn.com>

import type { FastifyInstance } from 'fastify'
import type { IDialect } from '@mostajs/orm'
import { randomBytes } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface ProjectManagerLike {
  addProject(config: any): Promise<void>
  removeProject?(name: string): Promise<void>
  hasProject(name: string): boolean
}

const TRIAL_TTL_DAYS  = 7
const TRIAL_RATE_LIMIT_PER_HOUR = 10
const TRIAL_DATA_DIR  = process.env.OCTONET_TRIAL_DATA_DIR || './data/trials'

// In-memory rate limiter — Map<ip, {count, resetAt}>
const _rateLimit = new Map<string, { count: number; resetAt: number }>()

function rateLimitCheck(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const window = 60 * 60 * 1000 // 1h
  let entry = _rateLimit.get(ip)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + window }
    _rateLimit.set(ip, entry)
  }
  entry.count++
  return {
    ok: entry.count <= TRIAL_RATE_LIMIT_PER_HOUR,
    remaining: Math.max(0, TRIAL_RATE_LIMIT_PER_HOUR - entry.count),
    resetAt: entry.resetAt,
  }
}

function sanitizeAlias(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (cleaned.length < 3 || cleaned.length > 30) return null
  return cleaned
}

/**
 * Load demo schemas from the host's schemas.json (Client, Product, Order).
 * Falls back to a minimal hardcoded set if schemas.json is missing.
 */
async function loadDemoSchemas(): Promise<any[]> {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const schemasFile = process.env.MOSTA_TRIAL_SCHEMAS || 'schemas.json'
    const fullPath = path.resolve(process.cwd(), schemasFile)
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
    }
  } catch (e: any) {
    console.warn(`[try] could not load demo schemas: ${e?.message || e}`)
  }
  // Minimal fallback : 1 Client schema so CRUD is at least possible
  return [{
    name: 'Client', collection: 'clients', timestamps: false,
    fields: {
      email:  { type: 'string', required: true },
      name:   { type: 'string', required: true },
      age:    { type: 'number', default: 0 },
      active: { type: 'boolean', default: true },
    },
    relations: {}, indexes: [],
  }]
}

async function ensureTrialDataDir(): Promise<string> {
  const dir = resolve(process.cwd(), TRIAL_DATA_DIR)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  return dir
}

export interface TryRoutesDeps {
  dialect: IDialect | null | undefined
  pm: ProjectManagerLike
}

export function registerTryRoutes(app: FastifyInstance, deps: TryRoutesDeps): void {
  const { dialect, pm } = deps

  // POST /try { alias } → create sandbox + return one-shot apikey
  app.post('/try', async (req, reply) => {
    if (!dialect) return reply.code(503).send({
      status: 'error', error: { code: 'UNAVAILABLE', message: 'Metadata DB not connected — try again later' },
    })

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || (req as any).ip || 'unknown'
    const rl = rateLimitCheck(ip)
    if (!rl.ok) {
      reply.header('Retry-After', String(Math.ceil((rl.resetAt - Date.now()) / 1000)))
      return reply.code(429).send({
        status: 'error', error: { code: 'RATE_LIMIT',
          message: `Too many sandboxes from this IP — limit ${TRIAL_RATE_LIMIT_PER_HOUR}/h. Reset at ${new Date(rl.resetAt).toISOString()}.` },
      })
    }

    const body = (req.body || {}) as any
    const aliasRaw = body.alias || `anon-${randomBytes(3).toString('hex')}`
    const alias = sanitizeAlias(aliasRaw)
    if (!alias) {
      return reply.code(400).send({
        status: 'error', error: { code: 'BAD_ALIAS',
          message: 'alias must be 3-30 chars, alphanumeric + hyphens (e.g. "alice-42")' },
      })
    }

    try {
      // Lazy-load mostajs dependencies
      const {
        UserRepository, RoleRepository, AccountRepository,
      } = await import('@mostajs/rbac/server')
      const { hashPassword } = await import('@mostajs/auth/lib/password')
      const { generateApiKey, getApiKeyRepo } = await import('@mostajs/api-keys/server')

      const userRepo    = new UserRepository(dialect)
      const roleRepo    = new RoleRepository(dialect)
      const accountRepo = new AccountRepository(dialect)
      const apikeyRepo  = getApiKeyRepo(dialect)

      const trialEmail = `${alias}@trial.octonet.amia.fr`

      // 1. Reject if alias already taken (case insensitive on email unique index)
      const existingUser = await userRepo.findByEmail(trialEmail)
      if (existingUser) {
        return reply.code(409).send({
          status: 'error', error: { code: 'ALIAS_TAKEN',
            message: `alias "${alias}" already exists — pick a different one` },
        })
      }

      // 2. Find shared trial-playground Account (created by RBAC bootstrap)
      let trialAccount = await accountRepo.findByType('trial')
      if (!trialAccount) {
        return reply.code(503).send({
          status: 'error', error: { code: 'NO_TRIAL_ACCOUNT',
            message: 'Trial Account not provisioned — RBAC bootstrap may have failed' },
        })
      }

      // 3. Create User
      const randomPwd = randomBytes(32).toString('hex')
      const newUser = await userRepo.create({
        email:     trialEmail,
        password:  await hashPassword(randomPwd),
        firstName: alias,
        lastName:  'Trial',
        status:    'active',
      } as any) as any

      // Attach role 'trial'
      const trialRole = await roleRepo.findOne({ name: 'trial' })
      if (trialRole && newUser?.id) {
        await userRepo.addRole(newUser.id, (trialRole as any).id)
      }

      // 4. Create SQLite sandbox file + project entry in PM
      await ensureTrialDataDir()
      const projectName = `sandbox-${alias}`
      const sandboxFile = join(TRIAL_DATA_DIR, `${alias}.sqlite`)

      if (pm.hasProject(projectName)) {
        // Should not happen given the email uniqueness check above, but guard anyway
        return reply.code(409).send({
          status: 'error', error: { code: 'PROJECT_EXISTS', message: `Project ${projectName} already exists` },
        })
      }

      // Pre-seed sandbox with demo schemas (Client, Product, Order)
      // → instant CRUD usable out of the box.
      // User can override via uploadSchemasJson on their sandbox.
      const demoSchemas = await loadDemoSchemas()
      await pm.addProject({
        name:     projectName,
        dialect:  'sqlite',
        uri:      sandboxFile,
        schemas:  demoSchemas,
        schemaStrategy: 'update',
      })

      // 5. Generate ApiKey scoped to the sandbox project (read+write, rest+mcp)
      const generated = generateApiKey('test')  // 'test' env → sk_test_…
      const expiresAt = new Date(Date.now() + TRIAL_TTL_DAYS * 24 * 3600 * 1000).toISOString()
      const apikey = await apikeyRepo.create({
        account:    (trialAccount as any).id,
        prefix:     generated.prefix,
        hash:       generated.hash,
        label:      `trial-${alias}`,
        permissions: {
          scopes: {
            projects:   [projectName],
            operations: ['read', 'write'],
            transports: ['rest', 'mcp'],
          },
          rateLimit: 500,  // 500 req/jour pour T1
        },
        enabled:    true,
        expiresAt,
        usageCount: 0,
      } as any) as any

      // 6. Build helpful response
      const baseUrl = `https://${(req.headers.host as string) || 'octonet.amia.fr'}`
      const exampleCurl = `curl ${baseUrl}/api/v1/${projectName}/User \\\n  -H "X-API-Key: ${generated.full}"`

      return reply.code(201).send({
        status: 'ok',
        data: {
          alias,
          projectSlug: projectName,
          apiKey:      generated.full,    // ⚠ shown ONCE — never re-derivable
          prefix:      generated.prefix,
          permissions: { projects: [projectName], operations: ['read','write'], transports: ['rest','mcp'] },
          expiresAt,
          quota: { reqPerDay: 500 },
          exampleCurl,
          mcpUrl: `${baseUrl}/mcp`,
          rateLimitRemaining: rl.remaining,
          message: `Sandbox ready. Save the apiKey — it is shown ONCE. Expires ${expiresAt}.`,
        },
      })
    } catch (e: any) {
      console.error('[try] sandbox creation failed:', e?.message || e)
      return reply.code(500).send({
        status: 'error', error: { code: 'SANDBOX_FAILED', message: e?.message || 'sandbox creation failed' },
      })
    }
  })

  // GET /try → simple HTML form (mounted in C2)
}

// ─────────────────────────────────────────────────────────────
//  Cleanup job — runs once per hour, deletes expired sandboxes
// ─────────────────────────────────────────────────────────────

let _cleanupTimer: NodeJS.Timeout | null = null

export function startTrialCleanupJob(deps: TryRoutesDeps): void {
  if (_cleanupTimer) return
  const { dialect, pm } = deps
  if (!dialect) return

  const tick = async () => {
    try {
      const { UserRepository, AccountRepository } = await import('@mostajs/rbac/server')
      const { getApiKeyRepo } = await import('@mostajs/api-keys/server')
      const userRepo    = new UserRepository(dialect)
      const accountRepo = new AccountRepository(dialect)
      const apikeyRepo  = getApiKeyRepo(dialect)

      const trialAccount = await accountRepo.findByType('trial') as any
      if (!trialAccount) return

      // Find expired apikeys belonging to the trial account
      const now = new Date()
      const allKeys = await apikeyRepo.findAll({ account: trialAccount.id }) as any[]
      const expired = allKeys.filter(k => k.expiresAt && new Date(k.expiresAt) < now)

      for (const k of expired) {
        const alias = (k.label || '').replace(/^trial-/, '')
        if (!alias) continue
        const projectName = `sandbox-${alias}`
        try {
          // Delete apikey
          await apikeyRepo.delete(k.id)
          // Delete project entry from PM (if supports it)
          if (pm.removeProject) await pm.removeProject(projectName).catch(() => {})
          // Delete SQLite file
          const sandboxFile = resolve(process.cwd(), TRIAL_DATA_DIR, `${alias}.sqlite`)
          if (existsSync(sandboxFile)) await unlink(sandboxFile).catch(() => {})
          // Delete the User
          const trialEmail = `${alias}@trial.octonet.amia.fr`
          const u = await userRepo.findByEmail(trialEmail)
          if (u && (u as any).id) await userRepo.delete((u as any).id).catch(() => {})

          console.log(`[trial-cleanup] expired sandbox removed: ${alias}`)
        } catch (e: any) {
          console.warn(`[trial-cleanup] failed to remove ${alias}:`, e?.message || e)
        }
      }
    } catch (e: any) {
      console.warn('[trial-cleanup] tick failed:', e?.message || e)
    }
  }

  // Run once at startup (after a delay) + every hour
  setTimeout(tick, 60_000)              // 1 min after start
  _cleanupTimer = setInterval(tick, 3_600_000)  // every hour
}

export function stopTrialCleanupJob(): void {
  if (_cleanupTimer) { clearInterval(_cleanupTimer); _cleanupTimer = null }
}
