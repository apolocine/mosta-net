// @mostajs/net — Schema loader
// Loads EntitySchema[] from schemas.json, .schema.ts files, or uploaded ZIP
// Author: Dr Hamid MADANI drmdh@msn.com

import fs from 'fs';
import path from 'path';
import type { EntitySchema } from '@mostajs/orm';

/**
 * Load schemas from schemas.json file
 */
export function loadSchemasFromJson(filePath: string): EntitySchema[] {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as EntitySchema[];
}

/**
 * Scan a directory for *.schema.ts files and extract EntitySchema objects.
 * Parses TypeScript files by extracting the object literal between { and }
 * after the EntitySchema type annotation.
 */
export function scanSchemaDir(dir: string): EntitySchema[] {
  const resolved = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(resolved)) return [];

  const files = fs.readdirSync(resolved).filter(f => f.endsWith('.schema.ts'));
  const schemas: EntitySchema[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(resolved, file), 'utf-8');
    const schema = parseSchemaFile(content, file);
    if (schema) schemas.push(schema);
  }

  return schemas;
}

/**
 * Scan multiple directories (comma-separated paths)
 */
export function scanSchemaDirs(paths: string): EntitySchema[] {
  const dirs = paths.split(',').map(d => d.trim()).filter(Boolean);
  const schemas: EntitySchema[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    for (const s of scanSchemaDir(dir)) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        schemas.push(s);
      }
    }
  }

  return schemas;
}

/**
 * Generate (or update) schemas.json from scanned schemas
 */
export function generateSchemasJson(schemas: EntitySchema[], outputPath = './schemas.json'): string {
  const resolved = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(resolved, JSON.stringify(schemas, null, 2) + '\n', 'utf-8');
  return resolved;
}

/**
 * Parse a single .schema.ts file and extract the EntitySchema object.
 * Uses a safe eval approach: strips TypeScript syntax and evaluates the object literal.
 */
function parseSchemaFile(content: string, filename: string): EntitySchema | null {
  try {
    // Remove import lines
    let code = content.replace(/^import\s+.*$/gm, '');

    // Remove 'export const XXX: EntitySchema =' prefix
    code = code.replace(/export\s+const\s+\w+\s*:\s*EntitySchema\s*=\s*/, '');

    // Remove TypeScript type assertions: 'as const', 'as any', etc.
    code = code.replace(/\bas\s+\w+/g, '');

    // Remove trailing semicolons after the object
    code = code.replace(/;\s*$/, '');

    // Remove single-line comments (but not inside strings)
    code = code.replace(/\/\/.*$/gm, '');

    // Remove multi-line comments
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');

    // Trim
    code = code.trim();

    // Should start with {
    if (!code.startsWith('{')) return null;

    // Evaluate safely using Function constructor (no access to require/import)
    const fn = new Function(`"use strict"; return (${code});`);
    const obj = fn();

    if (!obj || !obj.name || !obj.collection) return null;

    // Ensure required fields have defaults
    const schema: EntitySchema = {
      name: obj.name,
      collection: obj.collection,
      fields: obj.fields || {},
      relations: obj.relations || {},
      indexes: obj.indexes || [],
      timestamps: obj.timestamps ?? true,
    };

    // Optional fields
    if (obj.discriminator) schema.discriminator = obj.discriminator;
    if (obj.discriminatorValue) schema.discriminatorValue = obj.discriminatorValue;
    if (obj.softDelete) schema.softDelete = obj.softDelete;

    return schema;
  } catch {
    // Failed to parse — skip this file
    return null;
  }
}

/**
 * Parse schemas from uploaded ZIP buffer containing .schema.ts files
 */
export function parseSchemasFromZip(buffer: Buffer): EntitySchema[] {
  const schemas: EntitySchema[] = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    // Local file header signature
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const compSize = buffer.readUInt32LE(offset + 18);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf-8');
    const data = buffer.subarray(offset + 30 + nameLen + extraLen, offset + 30 + nameLen + extraLen + compSize);

    if (name.endsWith('.schema.ts')) {
      const content = data.toString('utf-8');
      const schema = parseSchemaFile(content, name);
      if (schema) schemas.push(schema);
    }

    offset += 30 + nameLen + extraLen + compSize;
  }

  return schemas;
}

/**
 * Get schemas config status
 */
export function getSchemasConfig(): {
  schemasJsonExists: boolean;
  schemasJsonPath: string;
  schemasPath: string;
  schemaCount: number;
  schemas: { name: string; collection: string; fieldsCount: number; relationsCount: number }[];
} {
  const schemasJsonPath = path.resolve(process.cwd(), 'schemas.json');
  const schemasPath = process.env.SCHEMAS_PATH || '';
  let schemas: EntitySchema[] = [];

  if (fs.existsSync(schemasJsonPath)) {
    try { schemas = JSON.parse(fs.readFileSync(schemasJsonPath, 'utf-8')); } catch {}
  }

  return {
    schemasJsonExists: fs.existsSync(schemasJsonPath),
    schemasJsonPath,
    schemasPath,
    schemaCount: schemas.length,
    schemas: schemas.map(s => ({
      name: s.name,
      collection: s.collection,
      fieldsCount: Object.keys(s.fields || {}).length,
      relationsCount: Object.keys(s.relations || {}).length,
    })),
  };
}
