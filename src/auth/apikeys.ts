// @mostajs/net — API Key management
// Reads .mosta/apikeys.json, validates keys, checks permissions
// Author: Dr Hamid MADANI drmdh@msn.com

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';

// ============================================================
// Types
// ============================================================

export interface Subscription {
  name: string;
  key: string | null;         // clear-text key (null if removed by admin)
  hash: string;               // SHA-256 of the key (for validation)
  created: string;            // ISO date
  status: 'active' | 'revoked';
  permissions: Record<string, Record<string, string>>;
  // permissions[dialect][transport] = 'r' | 'cr' | 'crud' | 'crud+s' | 'crud+sa'
  // '*' as wildcard for all dialects or all transports
}

export interface ApiKeysFile {
  subscriptions: Subscription[];
}

// ============================================================
// File I/O
// ============================================================

const APIKEYS_DIR = '.mosta';
const APIKEYS_FILE = 'apikeys.json';

function getApiKeysPath(): string {
  return join(process.cwd(), APIKEYS_DIR, APIKEYS_FILE);
}

/** Read .mosta/apikeys.json — returns empty if not found */
export function readApiKeys(): ApiKeysFile {
  const path = getApiKeysPath();
  if (!existsSync(path)) {
    return { subscriptions: [] };
  }
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as ApiKeysFile;
}

/** Write .mosta/apikeys.json */
export function writeApiKeys(data: ApiKeysFile): void {
  const dir = join(process.cwd(), APIKEYS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getApiKeysPath(), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ============================================================
// Key generation
// ============================================================

/** Generate a new API key with prefix msk_live_ or msk_test_ */
export function generateApiKey(mode: 'live' | 'test' = 'live'): string {
  const prefix = mode === 'live' ? 'msk_live_' : 'msk_test_';
  const random = randomBytes(24).toString('base64url');
  return prefix + random;
}

/** Hash a key with SHA-256 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// ============================================================
// Subscription CRUD
// ============================================================

/** Create a new subscription, returns the clear-text key (shown once) */
export function createSubscription(
  name: string,
  permissions: Record<string, Record<string, string>> = { '*': { '*': 'crud' } },
  mode: 'live' | 'test' = 'live',
): { subscription: Subscription; clearKey: string } {
  const data = readApiKeys();

  // Check duplicate name
  if (data.subscriptions.some(s => s.name === name)) {
    throw new Error(`Subscription "${name}" already exists`);
  }

  const clearKey = generateApiKey(mode);
  const subscription: Subscription = {
    name,
    key: clearKey,
    hash: hashApiKey(clearKey),
    created: new Date().toISOString().slice(0, 10),
    status: 'active',
    permissions,
  };

  data.subscriptions.push(subscription);
  writeApiKeys(data);

  return { subscription, clearKey };
}

/** Revoke a subscription by name */
export function revokeSubscription(name: string): boolean {
  const data = readApiKeys();
  const sub = data.subscriptions.find(s => s.name === name);
  if (!sub) return false;
  sub.status = 'revoked';
  sub.permissions = {};
  writeApiKeys(data);
  return true;
}

// ============================================================
// Validation
// ============================================================

/** Validate an API key and return the matching subscription (or null) */
export function validateApiKey(key: string): Subscription | null {
  const hash = hashApiKey(key);
  const data = readApiKeys();
  return data.subscriptions.find(s => s.hash === hash && s.status === 'active') || null;
}

/** Check if a subscription has permission for a given dialect + transport + operation */
export function checkPermission(
  sub: Subscription,
  dialect: string,
  transport: string,
  operation: 'r' | 'c' | 'u' | 'd',
): boolean {
  // Find matching permission entry (exact match or wildcard)
  const dialectPerms = sub.permissions[dialect] || sub.permissions['*'];
  if (!dialectPerms) return false;

  const rights = dialectPerms[transport] || dialectPerms['*'];
  if (!rights) return false;

  // Check operation against rights string
  switch (operation) {
    case 'r': return rights.includes('r');
    case 'c': return rights.includes('c') && rights.includes('r');  // 'cr' or 'crud'
    case 'u': return rights.includes('crud');
    case 'd': return rights.includes('crud');
    default: return false;
  }
}

/**
 * Map ORM operation to permission check letter
 */
export function opToPermission(op: string): 'r' | 'c' | 'u' | 'd' {
  switch (op) {
    case 'findAll':
    case 'findOne':
    case 'findById':
    case 'count':
    case 'search':
    case 'aggregate':
    case 'stream':
      return 'r';
    case 'create':
    case 'upsert':
      return 'c';
    case 'update':
      return 'u';
    case 'delete':
    case 'deleteMany':
      return 'd';
    default:
      return 'r';
  }
}
