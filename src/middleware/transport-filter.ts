// Author: Dr Hamid MADANI drmdh@msn.com
// @mostajs/net — Per-project transport filtering

/**
 * Filter which transports are available per project.
 * Allows enabling/disabling transports on a per-project basis
 * instead of global configuration only.
 */

const projectTransports = new Map<string, Set<string>>()

export const transportFilter = {
  /** Set allowed transports for a project */
  setProjectTransports(projectName: string, transports: string[]): void {
    projectTransports.set(projectName, new Set(transports))
  },

  /** Remove transport config for a project (falls back to global) */
  removeProjectTransports(projectName: string): void {
    projectTransports.delete(projectName)
  },

  /** Check if a transport is allowed for a project */
  isTransportAllowed(projectName: string, transport: string): boolean {
    const allowed = projectTransports.get(projectName)
    if (!allowed) return true  // no restriction = all allowed (global config)
    return allowed.has(transport)
  },

  /** Get allowed transports for a project (undefined = all global) */
  getProjectTransports(projectName: string): string[] | undefined {
    const allowed = projectTransports.get(projectName)
    return allowed ? Array.from(allowed) : undefined
  },

  /** List all projects with custom transport configs */
  listConfiguredProjects(): string[] {
    return Array.from(projectTransports.keys())
  },

  /** Clear all configs */
  clear(): void {
    projectTransports.clear()
  },

  /** Get count of configured projects */
  get size(): number {
    return projectTransports.size
  },
}
