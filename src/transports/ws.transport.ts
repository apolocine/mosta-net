// WebSocketTransport — Bidirectional WebSocket transport
// Clients send OrmRequest as JSON, receive OrmResponse + entity change events
// Author: Dr Hamid MADANI drmdh@msn.com

import { WebSocketServer, WebSocket } from 'ws';
import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

export class WebSocketTransport implements ITransport {
  readonly name = 'ws';

  private wss: WebSocketServer | null = null;
  private config: TransportConfig | null = null;
  private schemas: EntitySchema[] = [];
  private middlewares: TransportMiddleware[] = [];
  private ormHandler: OrmHandler | null = null;
  private stats = { requests: 0, errors: 0, startedAt: 0 };

  setHandler(handler: OrmHandler): void { this.ormHandler = handler; }
  use(mw: TransportMiddleware): void { this.middlewares.push(mw); }
  registerEntity(schema: EntitySchema): void { this.schemas.push(schema); }

  async start(config: TransportConfig): Promise<void> {
    this.config = config;
    this.stats.startedAt = Date.now();
    // WSS is created later when the HTTP server is available (see attachToServer)
  }

  async stop(): Promise<void> {
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close(1000, 'Server shutting down');
      }
      this.wss.close();
      this.wss = null;
    }
  }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.wss ? 'running' : 'stopped',
      url: this.config?.path || '/ws',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }

  /** Get connected client count */
  getClientCount(): number {
    return this.wss?.clients.size || 0;
  }

  /**
   * Attach WebSocket server to an existing HTTP server.
   * Called by server.ts after Fastify starts listening.
   */
  attachToServer(httpServer: import('http').Server): void {
    const path = this.config?.path || '/ws';

    this.wss = new WebSocketServer({ server: httpServer, path });

    this.wss.on('connection', (socket: WebSocket) => {
      // Send welcome message
      socket.send(JSON.stringify({
        type: 'connected',
        entities: this.schemas.map(s => s.name),
        connectedAt: new Date().toISOString(),
      }));

      // Handle incoming messages (OrmRequest)
      socket.on('message', async (raw: Buffer) => {
        this.stats.requests++;
        try {
          const req: OrmRequest = JSON.parse(raw.toString());
          const res = await this.handleRequest(req);
          socket.send(JSON.stringify({ type: 'response', ...res }));
        } catch (err: any) {
          this.stats.errors++;
          socket.send(JSON.stringify({
            type: 'response',
            status: 'error',
            error: { code: 'PARSE_ERROR', message: err.message },
          }));
        }
      });
    });
  }

  /**
   * Broadcast an entity change event to all connected WebSocket clients.
   */
  broadcast(eventName: string, data: Record<string, unknown>): void {
    if (!this.wss) return;
    const payload = JSON.stringify({ type: 'event', event: eventName, ...data });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private async handleRequest(req: OrmRequest): Promise<OrmResponse> {
    if (!this.ormHandler) {
      return { status: 'error', error: { code: 'NO_HANDLER', message: 'ORM handler not initialized' } };
    }
    const ctx: TransportContext = { transport: this.name };
    return this.ormHandler(req, ctx);
  }
}

/** Factory */
export function createTransport(): ITransport {
  return new WebSocketTransport();
}
