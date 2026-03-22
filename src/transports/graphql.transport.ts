// GraphQLTransport — Auto-generates GraphQL schema from EntitySchemas
// Queries and mutations call EntityService via OrmRequest/OrmResponse
// Author: Dr Hamid MADANI drmdh@msn.com

import type { EntitySchema, OrmRequest, OrmResponse } from '@mostajs/orm';
import type { ITransport, TransportConfig, TransportInfo, TransportMiddleware, TransportContext } from '../core/types.js';

type OrmHandler = (req: OrmRequest, ctx: TransportContext) => Promise<OrmResponse>;

export class GraphQLTransport implements ITransport {
  readonly name = 'graphql';

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
  }

  async stop(): Promise<void> { this.config = null; }

  getInfo(): TransportInfo {
    return {
      name: this.name,
      status: this.config ? 'running' : 'stopped',
      url: this.config?.path || '/graphql',
      entities: this.schemas.map(s => s.name),
      stats: { ...this.stats },
    };
  }

  /**
   * Generate the GraphQL SDL schema string from registered EntitySchemas.
   */
  generateSchema(): string {
    const types: string[] = [];
    const queries: string[] = [];
    const mutations: string[] = [];

    for (const schema of this.schemas) {
      const name = schema.name;
      const fields = Object.entries(schema.fields);

      // Type definition
      const fieldDefs = [
        '  id: ID!',
        ...fields.map(([fname, fdef]) => `  ${fname}: ${gqlType(fdef.type, fdef.required)}`),
        ...(schema.timestamps ? ['  createdAt: String', '  updatedAt: String'] : []),
      ];
      types.push(`type ${name} {\n${fieldDefs.join('\n')}\n}`);

      // Input type for create/update
      const inputFields = fields.map(([fname, fdef]) =>
        `  ${fname}: ${gqlInputType(fdef.type, fdef.required && fname !== 'id')}`
      );
      types.push(`input ${name}Input {\n${inputFields.join('\n')}\n}`);

      // Queries
      queries.push(`  ${lcfirst(name)}s(filter: String, limit: Int, skip: Int, sort: String): [${name}!]!`);
      queries.push(`  ${lcfirst(name)}(id: ID!): ${name}`);
      queries.push(`  ${lcfirst(name)}Count(filter: String): Int!`);

      // Mutations
      mutations.push(`  create${name}(input: ${name}Input!): ${name}!`);
      mutations.push(`  update${name}(id: ID!, input: ${name}Input!): ${name}`);
      mutations.push(`  delete${name}(id: ID!): Boolean!`);
    }

    return [
      ...types,
      `type Query {\n${queries.join('\n')}\n}`,
      `type Mutation {\n${mutations.join('\n')}\n}`,
    ].join('\n\n');
  }

  /**
   * Generate resolvers that call OrmHandler.
   */
  generateResolvers(): Record<string, Record<string, Function>> {
    const Query: Record<string, Function> = {};
    const Mutation: Record<string, Function> = {};

    for (const schema of this.schemas) {
      const name = schema.name;

      // Query: users(filter, limit, skip, sort)
      Query[`${lcfirst(name)}s`] = async (_: any, args: any) => {
        this.stats.requests++;
        const req: OrmRequest = {
          op: 'findAll',
          entity: name,
          filter: args.filter ? JSON.parse(args.filter) : {},
          options: {
            limit: args.limit,
            skip: args.skip,
            sort: args.sort ? JSON.parse(args.sort) : undefined,
          },
        };
        const res = await this.callOrm(req);
        return res.data || [];
      };

      // Query: user(id)
      Query[lcfirst(name)] = async (_: any, args: { id: string }) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'findById', entity: name, id: args.id });
        return res.data;
      };

      // Query: userCount(filter)
      Query[`${lcfirst(name)}Count`] = async (_: any, args: any) => {
        this.stats.requests++;
        const res = await this.callOrm({
          op: 'count', entity: name,
          filter: args.filter ? JSON.parse(args.filter) : {},
        });
        return res.data || 0;
      };

      // Mutation: createUser(input)
      Mutation[`create${name}`] = async (_: any, args: { input: Record<string, unknown> }) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'create', entity: name, data: args.input });
        if (res.status === 'error') throw new Error(res.error?.message);
        return res.data;
      };

      // Mutation: updateUser(id, input)
      Mutation[`update${name}`] = async (_: any, args: { id: string; input: Record<string, unknown> }) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'update', entity: name, id: args.id, data: args.input });
        if (res.status === 'error') throw new Error(res.error?.message);
        return res.data;
      };

      // Mutation: deleteUser(id)
      Mutation[`delete${name}`] = async (_: any, args: { id: string }) => {
        this.stats.requests++;
        const res = await this.callOrm({ op: 'delete', entity: name, id: args.id });
        return res.data === true;
      };
    }

    return { Query, Mutation };
  }

  private async callOrm(req: OrmRequest): Promise<OrmResponse> {
    if (!this.ormHandler) {
      return { status: 'error', error: { code: 'NO_HANDLER', message: 'ORM handler not initialized' } };
    }
    const ctx: TransportContext = { transport: this.name };
    return this.ormHandler(req, ctx);
  }
}

// ============================================================
// Helpers
// ============================================================

function gqlType(type: string, required?: boolean): string {
  const base = fieldTypeToGql(type);
  return required ? `${base}!` : base;
}

function gqlInputType(type: string, required?: boolean): string {
  const base = fieldTypeToGql(type);
  return required ? `${base}!` : base;
}

function fieldTypeToGql(type: string): string {
  switch (type) {
    case 'string': case 'text': return 'String';
    case 'number': return 'Float';
    case 'boolean': return 'Boolean';
    case 'date': return 'String';
    case 'json': return 'String';
    case 'array': return '[String]';
    default: return 'String';
  }
}

function lcfirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Factory */
export function createTransport(): ITransport {
  return new GraphQLTransport();
}
