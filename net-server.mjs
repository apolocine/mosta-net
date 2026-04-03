// Author: Dr Hamid MADANI drmdh@msn.com
// Start @mostajs/net server with SecuAccessPro schemas
// Usage: node net-server.mjs
import { registerSchemas } from '@mostajs/orm';
import { startServer } from '@mostajs/net';

// Import all schemas
import { UserSchema } from './src/dal/schemas/user.schema.ts';
import { ClientSchema } from './src/dal/schemas/client.schema.ts';
import { RoleSchema } from './src/dal/schemas/role.schema.ts';
import { PermissionSchema } from './src/dal/schemas/permission.schema.ts';
import { PermissionCategorySchema } from './src/dal/schemas/permission-category.schema.ts';
import { ActivitySchema } from './src/dal/schemas/activity.schema.ts';
import { SubscriptionPlanSchema } from './src/dal/schemas/subscription-plan.schema.ts';
import { ClientAccessSchema } from './src/dal/schemas/client-access.schema.ts';
import { TicketSchema } from './src/dal/schemas/ticket.schema.ts';
import { ScanLogSchema } from './src/dal/schemas/scan-log.schema.ts';
import { AuditLogSchema } from './src/dal/schemas/audit-log.schema.ts';
import { LockerSchema } from './src/dal/schemas/locker.schema.ts';
import { RfidTagSchema } from './src/dal/schemas/rfid-tag.schema.ts';
import { LockerEventSchema } from './src/dal/schemas/locker-event.schema.ts';
import { SettingSchema } from './src/dal/schemas/setting.schema.ts';

registerSchemas([
  UserSchema, ClientSchema, RoleSchema, PermissionSchema,
  PermissionCategorySchema, ActivitySchema, SubscriptionPlanSchema,
  ClientAccessSchema, TicketSchema, ScanLogSchema, AuditLogSchema,
  LockerSchema, RfidTagSchema, LockerEventSchema, SettingSchema,
]);

await startServer();
