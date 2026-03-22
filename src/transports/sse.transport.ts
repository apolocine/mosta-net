// SSETransport — Server-Sent Events transport adapter
// Pushes entity change notifications (created, updated, deleted) to connected clients
// Author: Dr Hamid MADANI drmdh@msn.com

import type { EntitySchema } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware } from '../core/types.js';
import type { ServerResponse } from 'http';

/**
 * SSETransport streams entity change events to clients via Server-Sent Events.
 *
 * Clients connect to GET /events (or configured path) and receive:
 *   event: entity.created
 *   data: {"entity":"User","data":{...}}
 *
 *   event: entity.updated
 *   data: {"entity":"User","id":"123","data":{...}}
 *
 *   event: entity.deleted
 *   data: {"entity":"User","id":"123"}
 */
export class SSETransport implements ITransport {
  readonly name = 'sse';

  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private clients = new Set<ServerResponse>();
  private stats = { requests: 0, errors: 0, startedAt: 0 };

  use(middleware: TransportMiddleware): void {
    this.middlewares.push(middleware);
  }

  registerEntity(schema: EntitySchema): void {
    this.schemas.push(schema);
  }

  async start(config: TransportConfig): Promise<void> {
    this.config = config;
    this.stats.startedAt = Date.now();
  }

  async stop(): Promise<void> {
    // Close all connected clients
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.config ? 'running' : 'stopped',
      url: this.config?.path || '/events',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }

  /** Get the SSE path for Fastify route registration */
  getPath(): string {
    return this.config?.path || '/events';
  }

  /** Get connected client count */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Handle a new SSE client connection.
   * Called by the server when a GET request arrives at the SSE path.
   */
  addClient(res: ServerResponse): void {
    this.stats.requests++;

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial comment (keep-alive)
    res.write(':ok\n\n');

    // Send connected event with available entities
    const connectData = JSON.stringify({
      entities: this.schemas.map(s => s.name),
      connectedAt: new Date().toISOString(),
    });
    res.write(`event: connected\ndata: ${connectData}\n\n`);

    this.clients.add(res);

    // Remove client on disconnect
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Broadcast an event to all connected SSE clients.
   * Called by the server when EntityService emits change events.
   */
  broadcast(eventName: string, data: Record<string, unknown>): void {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const client of this.clients) {
      client.write(payload);
    }
  }
}

/** Factory function */
export function createTransport(): ITransport {
  return new SSETransport();
}
