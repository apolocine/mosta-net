// Author: Dr Hamid MADANI drmdh@msn.com
// @mostajs/net — Tests for cloud extensions (E1-E4)

import { cloudHook, type CloudMiddlewareFn } from '../src/middleware/cloud-hook.js'
import { transportFilter } from '../src/middleware/transport-filter.js'
import { createAdminAuth } from '../src/middleware/admin-auth.js'
import { projectMetrics } from '../src/middleware/project-metrics.js'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}`)
  }
}

// ── T1 — Cloud hook ──────────────────────────────────────────────────
console.log('\n── T1 — Cloud hook ──')

assert('isEnabled() === false initially', cloudHook.isEnabled() === false)

const mockResult = { passed: true, context: { tier: 'pro' } }
const mockMiddleware: CloudMiddlewareFn = async (_rawKey, _slug, _transport, _method) => mockResult

// process with no middleware → passed=true
const noMwResult = await cloudHook.process(undefined, 'proj', 'rest', 'GET')
assert('process with no middleware → passed=true', noMwResult.passed === true)

cloudHook.setMiddleware(mockMiddleware)
assert('setMiddleware → isEnabled() === true', cloudHook.isEnabled() === true)
assert('getMiddleware returns function', cloudHook.getMiddleware() === mockMiddleware)

const mwResult = await cloudHook.process('key123', 'proj', 'rest', 'GET')
assert('process with middleware → returns result', mwResult.passed === true && mwResult.context?.tier === 'pro')

cloudHook.removeMiddleware()
assert('removeMiddleware → isEnabled() === false', cloudHook.isEnabled() === false)
assert('getMiddleware returns null after remove', cloudHook.getMiddleware() === null)

// ── T2 — Transport filter ────────────────────────────────────────────
console.log('\n── T2 — Transport filter ──')

transportFilter.clear()

assert('no config = all allowed', transportFilter.isTransportAllowed('proj', 'rest') === true)
assert('getProjectTransports undefined when no config', transportFilter.getProjectTransports('proj') === undefined)

transportFilter.setProjectTransports('proj', ['rest', 'mcp'])
assert('rest allowed after config', transportFilter.isTransportAllowed('proj', 'rest') === true)
assert('mcp allowed after config', transportFilter.isTransportAllowed('proj', 'mcp') === true)
assert('graphql NOT allowed after config', transportFilter.isTransportAllowed('proj', 'graphql') === false)

const transports = transportFilter.getProjectTransports('proj')
assert('getProjectTransports returns array', Array.isArray(transports) && transports.length === 2)
assert('listConfiguredProjects includes proj', transportFilter.listConfiguredProjects().includes('proj'))
assert('size === 1', transportFilter.size === 1)

transportFilter.removeProjectTransports('proj')
assert('after remove, all allowed again', transportFilter.isTransportAllowed('proj', 'graphql') === true)
assert('size === 0 after remove', transportFilter.size === 0)

transportFilter.setProjectTransports('a', ['rest'])
transportFilter.setProjectTransports('b', ['grpc'])
assert('size === 2', transportFilter.size === 2)
transportFilter.clear()
assert('clear resets everything', transportFilter.size === 0)

// ── T3 — Admin auth ─────────────────────────────────────────────────
console.log('\n── T3 — Admin auth ──')

const checkBasic = createAdminAuth({ username: 'admin', password: 'secret' })

const validBasic = await checkBasic({ headers: { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') } })
assert('valid basic auth → authorized=true method=basic', validBasic.authorized === true && validBasic.method === 'basic')

const invalidBasic = await checkBasic({ headers: { authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') } })
assert('invalid basic auth → authorized=false', invalidBasic.authorized === false && invalidBasic.method === 'basic')

const noAuth = await checkBasic({ headers: {} })
assert('no auth → authorized=false method=none', noAuth.authorized === false && noAuth.method === 'none')

const checkApiKey = createAdminAuth({
  verifyApiKey: async (key: string) => key === 'valid-key-123',
})

const validKey = await checkApiKey({ headers: { 'x-api-key': 'valid-key-123' } })
assert('valid API key → authorized=true method=apikey', validKey.authorized === true && validKey.method === 'apikey')

const invalidKey = await checkApiKey({ headers: { 'x-api-key': 'bad-key' } })
assert('invalid API key → authorized=false method=apikey', invalidKey.authorized === false && invalidKey.method === 'apikey')

// ── T4 — Project metrics ────────────────────────────────────────────
console.log('\n── T4 — Project metrics ──')

projectMetrics.resetAll()

assert('no metrics initially', projectMetrics.getMetrics('proj') === undefined)
assert('size === 0', projectMetrics.size === 0)

projectMetrics.recordRequest('proj', 'read', 50)
projectMetrics.recordRequest('proj', 'read', 100)
projectMetrics.recordRequest('proj', 'write', 150, true)

const m = projectMetrics.getMetrics('proj')!
assert('requests === 3', m.requests === 3)
assert('reads === 2', m.reads === 2)
assert('writes === 1', m.writes === 1)
assert('errors === 1', m.errors === 1)
assert('totalLatencyMs === 300', m.totalLatencyMs === 300)
assert('lastRequestAt > 0', m.lastRequestAt > 0)

assert('getAvgLatency === 100', projectMetrics.getAvgLatency('proj') === 100)
assert('getAvgLatency unknown === 0', projectMetrics.getAvgLatency('unknown') === 0)

projectMetrics.recordRequest('other', 'read', 200)
const all = projectMetrics.getAllMetrics()
assert('getAllMetrics returns 2', all.length === 2)

const summary = projectMetrics.getSummary()
assert('summary totalRequests === 4', summary.totalRequests === 4)
assert('summary totalErrors === 1', summary.totalErrors === 1)
assert('summary projectCount === 2', summary.projectCount === 2)
assert('summary avgLatency === 125', summary.avgLatency === 125)

projectMetrics.reset('proj')
assert('reset clears project', projectMetrics.getMetrics('proj') === undefined)
assert('size === 1 after reset', projectMetrics.size === 1)

projectMetrics.resetAll()
assert('resetAll clears all', projectMetrics.size === 0)

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n══ Summary: ${passed} passed, ${failed} failed ══`)
process.exit(failed > 0 ? 1 : 0)
