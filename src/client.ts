// NetClient — Lightweight REST client for @mostajs/net server
// Zero dependencies — uses native fetch() (Node 18+)
// Import via: import { NetClient, createNetDialectProxy } from '@mostajs/net/client'
// Author: Dr Hamid MADANI drmdh@msn.com

export { createNetDialectProxy } from './dialect-proxy.js'

// ============================================================
// Types
// ============================================================

export interface NetClientConfig {
  /** Base URL of the @mostajs/net server (e.g. "http://localhost:4488") */
  url: string;
  /** Optional API key for authenticated access */
  apiKey?: string;
}

export interface QueryOptions {
  sort?: Record<string, number>;
  limit?: number;
  skip?: number;
  select?: string[];
  exclude?: string[];
}

export interface CompareSchemaResult {
  compatible: boolean;
  exists: boolean;
  diffs?: Array<{ type: string; field?: string; detail?: string }>;
}

// ============================================================
// NetClient
// ============================================================

export class NetClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: NetClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  // ── Internal helpers ────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return h;
  }

  private async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error((err as any).error?.message ?? `NET ${method} ${path} failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  private qs(params: Record<string, string | undefined>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') p.set(k, v);
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  // ── Lifecycle ───────────────────────────────────────

  /** Check if the NET server is reachable */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── CRUD ────────────────────────────────────────────

  /** Find all documents in a collection */
  async findAll<T = any>(collection: string, filter?: Record<string, unknown>, options?: QueryOptions): Promise<T[]> {
    const q = this.qs({
      filter: filter && Object.keys(filter).length ? JSON.stringify(filter) : undefined,
      sort: options?.sort ? JSON.stringify(options.sort) : undefined,
      limit: options?.limit?.toString(),
      skip: options?.skip?.toString(),
      select: options?.select?.join(','),
      exclude: options?.exclude?.join(','),
    });
    const json = await this.request<any>('GET', `/api/v1/${collection}${q}`);
    return json.data ?? [];
  }

  /** Find a single document by filter */
  async findOne<T = any>(collection: string, filter: Record<string, unknown>): Promise<T | null> {
    const q = this.qs({ filter: JSON.stringify(filter) });
    const json = await this.request<any>('GET', `/api/v1/${collection}/one${q}`);
    return json.data ?? null;
  }

  /** Find a document by ID */
  async findById<T = any>(collection: string, id: string): Promise<T | null> {
    try {
      const json = await this.request<any>('GET', `/api/v1/${collection}/${id}`);
      return json.data ?? null;
    } catch {
      return null;
    }
  }

  /** Create a new document */
  async create<T = any>(collection: string, data: Record<string, unknown>): Promise<T> {
    const json = await this.request<any>('POST', `/api/v1/${collection}`, data);
    return json.data;
  }

  /** Update a document by ID */
  async update<T = any>(collection: string, id: string, data: Record<string, unknown>): Promise<T | null> {
    const json = await this.request<any>('PUT', `/api/v1/${collection}/${id}`, data);
    return json.data ?? null;
  }

  /** Insert or update a document */
  async upsert<T = any>(collection: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<T> {
    const json = await this.request<any>('POST', `/api/v1/${collection}/upsert`, { filter, data });
    return json.data;
  }

  /** Delete a document by ID */
  async delete(collection: string, id: string): Promise<boolean> {
    try {
      await this.request('DELETE', `/api/v1/${collection}/${id}`);
      return true;
    } catch {
      return false;
    }
  }

  /** Delete multiple documents by filter */
  async deleteMany(collection: string, filter: Record<string, unknown>): Promise<number> {
    const json = await this.request<any>('DELETE', `/api/v1/${collection}/bulk`, { filter });
    return json.metadata?.count ?? 0;
  }

  /** Update multiple documents by filter */
  async updateMany(collection: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<number> {
    const json = await this.request<any>('PUT', `/api/v1/${collection}/bulk`, { filter, data });
    return json.metadata?.count ?? 0;
  }

  /** Count documents in a collection */
  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    const q = filter && Object.keys(filter).length
      ? this.qs({ filter: JSON.stringify(filter) }) : '';
    const json = await this.request<any>('GET', `/api/v1/${collection}/count${q}`);
    return json.data ?? 0;
  }

  // ── Relations ───────────────────────────────────────

  /** Find all with populated relations */
  async findWithRelations<T = any>(
    collection: string, filter: Record<string, unknown>,
    relations: string[], options?: Omit<QueryOptions, 'select' | 'exclude'>,
  ): Promise<T[]> {
    const q = this.qs({
      filter: Object.keys(filter).length ? JSON.stringify(filter) : undefined,
      relations: relations.join(','),
      sort: options?.sort ? JSON.stringify(options.sort) : undefined,
      limit: options?.limit?.toString(),
      skip: options?.skip?.toString(),
    });
    const json = await this.request<any>('GET', `/api/v1/${collection}${q}`);
    return json.data ?? [];
  }

  /** Find by ID with populated relations */
  async findByIdWithRelations<T = any>(collection: string, id: string, relations: string[]): Promise<T | null> {
    const q = this.qs({ relations: relations.join(',') });
    try {
      const json = await this.request<any>('GET', `/api/v1/${collection}/${id}${q}`);
      return json.data ?? null;
    } catch {
      return null;
    }
  }

  // ── Atomic operations ───────────────────────────────

  /** Add a value to an array field (no duplicates) */
  async addToSet<T = any>(collection: string, id: string, field: string, value: unknown): Promise<T | null> {
    const json = await this.request<any>('POST', `/api/v1/${collection}/${id}/addToSet`, { field, value });
    return json.data ?? null;
  }

  /** Remove a value from an array field */
  async pull<T = any>(collection: string, id: string, field: string, value: unknown): Promise<T | null> {
    const json = await this.request<any>('POST', `/api/v1/${collection}/${id}/pull`, { field, value });
    return json.data ?? null;
  }

  /** Increment a numeric field */
  async increment<T = any>(collection: string, id: string, field: string, amount: number): Promise<T | null> {
    const json = await this.request<any>('POST', `/api/v1/${collection}/${id}/increment`, { field, amount });
    return json.data ?? null;
  }

  // ── Search & Aggregate ──────────────────────────────

  /** Full-text search */
  async search<T = any>(collection: string, query: string, fields?: string[], options?: { limit?: number; skip?: number }): Promise<T[]> {
    const json = await this.request<any>('POST', `/api/v1/${collection}/search`, { query, fields, options });
    return json.data ?? [];
  }

  /** Aggregation pipeline */
  async aggregate<T = any>(collection: string, stages: Record<string, unknown>[]): Promise<T[]> {
    const json = await this.request<any>('POST', `/api/v1/${collection}/aggregate`, { stages });
    return json.data ?? [];
  }

  // ── Schema management ───────────────────────────────

  /** Test DB connection on the remote server */
  async testDbConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const json = await this.request<any>('POST', '/api/test-connection');
      return { ok: json.ok ?? true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Get schemas config from the remote server */
  async getSchemasConfig(): Promise<{ schemas: string[]; strategy: string; dialect: string }> {
    const json = await this.request<any>('GET', '/api/schemas-config');
    return json.data ?? json;
  }

  /** Compare a local schema with the remote server's version (delegates to ORM.diffSchemas) */
  async compareSchema(schema: Record<string, unknown>): Promise<CompareSchemaResult> {
    const json = await this.request<any>('POST', '/api/compare-schema', { schema });
    return json.data ?? json;
  }

  /** Apply schemas on the remote server (create/update tables) */
  async applySchema(schemas: Record<string, unknown>[]): Promise<{ ok: boolean; applied: string[] }> {
    const json = await this.request<any>('POST', '/api/apply-schema', {
      schemas: schemas.map(s => ({
        name: (s as any).name,
        collection: (s as any).collection,
        fields: (s as any).fields,
        relations: (s as any).relations,
        indexes: (s as any).indexes,
        timestamps: (s as any).timestamps,
      })),
    });
    return json.data ?? json;
  }
}
