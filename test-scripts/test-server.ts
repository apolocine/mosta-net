// Quick integration test — start server with a test schema
// Author: Dr Hamid MADANI drmdh@msn.com
import { registerSchema } from '@mostajs/orm';
import type { EntitySchema } from '@mostajs/orm';

// Register a test schema BEFORE starting the server
const UserSchema: EntitySchema = {
  name: 'User',
  collection: 'users',
  fields: {
    name:  { type: 'string', required: true },
    email: { type: 'string', required: true, unique: true },
    role:  { type: 'string', default: 'user', enum: ['admin', 'user', 'editor'] },
  },
  relations: {},
  indexes: [{ fields: { email: 'asc' }, unique: true }],
  timestamps: true,
};

registerSchema(UserSchema);

// Now start the server
import { startServer } from './src/server.js';

startServer().then((server) => {
  console.log('\n  Test: curl http://localhost:4488/api/v1/users');
  console.log('  Test: curl http://localhost:4488/health\n');

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
});
