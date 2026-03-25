import { registerSchemas } from '@mostajs/orm';
import { startServer } from '../dist/index.js';

const UserSchema = {
  name: 'NetUser', collection: 'net_users',
  fields: { name: { type: 'string', required: true }, email: { type: 'string', required: true } },
  relations: {}, indexes: [], timestamps: true,
};
const ActivitySchema = {
  name: 'NetActivity', collection: 'net_activities',
  fields: { name: { type: 'string', required: true }, slug: { type: 'string', required: true } },
  relations: {}, indexes: [], timestamps: true,
};

registerSchemas([UserSchema, ActivitySchema]);
await startServer();
