// @mostajs/net — Replicator admin routes
// CQRS replicas + CDC replication rules management
// Author: Dr Hamid MADANI drmdh@msn.com

import type { FastifyInstance } from 'fastify';
import type { ReplicationManager } from '@mostajs/replicator';

/**
 * Register replicator admin API routes.
 * Called only when @mostajs/replicator is installed.
 */
export function registerReplicatorRoutes(app: FastifyInstance, rm: ReplicationManager): void {

  // ══════════════════════════════════════════════════════════
  // Replicas per project
  // ══════════════════════════════════════════════════════════

  // GET /api/projects/:name/replicas — list replicas
  app.get('/api/projects/:name/replicas', async (req) => {
    const { name } = req.params as { name: string };
    return rm.getReplicaStatus(name);
  });

  // POST /api/projects/:name/replicas — add replica
  app.post('/api/projects/:name/replicas', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as { name: string; role: 'master' | 'slave'; dialect: string; uri: string; pool?: { min: number; max: number } };
    try {
      await rm.addReplica(name, body);
      return { ok: true, message: `Replica "${body.name}" ajoutee au projet "${name}"` };
    } catch (e: any) {
      reply.status(400);
      return { ok: false, error: e.message };
    }
  });

  // DELETE /api/projects/:name/replicas/:replica — remove replica
  app.delete('/api/projects/:name/replicas/:replica', async (req, reply) => {
    const { name, replica } = req.params as { name: string; replica: string };
    try {
      await rm.removeReplica(name, replica);
      return { ok: true, message: `Replica "${replica}" supprimee` };
    } catch (e: any) {
      reply.status(400);
      return { ok: false, error: e.message };
    }
  });

  // POST /api/projects/:name/replicas/:replica/promote — failover
  app.post('/api/projects/:name/replicas/:replica/promote', async (req, reply) => {
    const { name, replica } = req.params as { name: string; replica: string };
    try {
      await rm.promoteToMaster(name, replica);
      return { ok: true, message: `Replica "${replica}" promue master` };
    } catch (e: any) {
      reply.status(400);
      return { ok: false, error: e.message };
    }
  });

  // PUT /api/projects/:name/read-routing — set strategy
  app.put('/api/projects/:name/read-routing', async (req) => {
    const { name } = req.params as { name: string };
    const { strategy } = req.body as { strategy: 'round-robin' | 'least-lag' | 'random' };
    rm.setReadRouting(name, strategy);
    return { ok: true, strategy };
  });

  // ══════════════════════════════════════════════════════════
  // Replication rules (CDC)
  // ══════════════════════════════════════════════════════════

  // GET /api/replicas/rules — list all rules
  app.get('/api/replicas/rules', async () => {
    return { rules: rm.listRules() };
  });

  // POST /api/replicas/rules — add rule
  app.post('/api/replicas/rules', async (req, reply) => {
    const body = req.body as any;
    try {
      rm.addReplicationRule(body);
      return { ok: true, message: `Regle "${body.name}" creee` };
    } catch (e: any) {
      reply.status(400);
      return { ok: false, error: e.message };
    }
  });

  // DELETE /api/replicas/rules/:name — remove rule
  app.delete('/api/replicas/rules/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      rm.removeReplicationRule(name);
      return { ok: true, message: `Regle "${name}" supprimee` };
    } catch (e: any) {
      reply.status(400);
      return { ok: false, error: e.message };
    }
  });

  // POST /api/replicas/rules/:name/sync — trigger sync
  app.post('/api/replicas/rules/:name/sync', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const stats = await rm.sync(name);
      return { ok: true, stats };
    } catch (e: any) {
      reply.status(400);
      return { ok: false, error: e.message };
    }
  });

  // GET /api/replicas/rules/:name/stats — get sync stats
  app.get('/api/replicas/rules/:name/stats', async (req, reply) => {
    const { name } = req.params as { name: string };
    const stats = rm.getSyncStats(name);
    if (!stats) {
      reply.status(404);
      return { error: `Stats pour "${name}" introuvables` };
    }
    return { stats };
  });
}
