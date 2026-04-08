// Author: Dr Hamid MADANI drmdh@msn.com
// @mostajs/net — Per-project metrics collector

export interface ProjectMetrics {
  projectName: string
  requests: number
  reads: number
  writes: number
  errors: number
  totalLatencyMs: number
  lastRequestAt: number
}

const metrics = new Map<string, ProjectMetrics>()

function ensureMetrics(projectName: string): ProjectMetrics {
  let m = metrics.get(projectName)
  if (!m) {
    m = { projectName, requests: 0, reads: 0, writes: 0, errors: 0, totalLatencyMs: 0, lastRequestAt: 0 }
    metrics.set(projectName, m)
  }
  return m
}

export const projectMetrics = {
  /** Record a request for a project */
  recordRequest(projectName: string, type: 'read' | 'write', latencyMs: number, isError: boolean = false): void {
    const m = ensureMetrics(projectName)
    m.requests++
    if (type === 'read') m.reads++
    else m.writes++
    if (isError) m.errors++
    m.totalLatencyMs += latencyMs
    m.lastRequestAt = Date.now()
  },

  /** Get metrics for a project */
  getMetrics(projectName: string): ProjectMetrics | undefined {
    return metrics.get(projectName)
  },

  /** Get metrics for all projects */
  getAllMetrics(): ProjectMetrics[] {
    return Array.from(metrics.values())
  },

  /** Get average latency for a project */
  getAvgLatency(projectName: string): number {
    const m = metrics.get(projectName)
    if (!m || m.requests === 0) return 0
    return Math.round(m.totalLatencyMs / m.requests)
  },

  /** Get requests per second for a project (over last window) */
  getRequestsPerSecond(projectName: string, windowMs: number = 60000): number {
    const m = metrics.get(projectName)
    if (!m || m.requests === 0) return 0
    const elapsed = Date.now() - (m.lastRequestAt - (m.totalLatencyMs / m.requests) * m.requests)
    if (elapsed <= 0) return 0
    return Math.round((m.requests / Math.max(elapsed, windowMs)) * 1000 * 100) / 100
  },

  /** Reset metrics for a project */
  reset(projectName: string): void {
    metrics.delete(projectName)
  },

  /** Reset all metrics */
  resetAll(): void {
    metrics.clear()
  },

  /** Get summary (total across all projects) */
  getSummary(): { totalRequests: number; totalErrors: number; projectCount: number; avgLatency: number } {
    let totalRequests = 0, totalErrors = 0, totalLatency = 0
    for (const m of metrics.values()) {
      totalRequests += m.requests
      totalErrors += m.errors
      totalLatency += m.totalLatencyMs
    }
    return {
      totalRequests,
      totalErrors,
      projectCount: metrics.size,
      avgLatency: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    }
  },

  get size(): number { return metrics.size },
}
