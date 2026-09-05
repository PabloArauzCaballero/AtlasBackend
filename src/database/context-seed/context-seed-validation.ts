/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system valida la forma del paquete de contexto antes de escribir una sola fila.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import type { JsonRecord } from './context-seed.types.js';

const EXPECTED_SCHEMA_VERSION = '2.0.0';

/**
 * Claves de identidad que el paquete NO puede traer: los ids los asigna la base.
 *
 * Un paquete que llega con `_id` propio parece inofensivo hasta que se siembra en otra base y esos
 * ids ya pertenecen a otra fila. La validación se hace antes de escribir nada, no al fallar la
 * inserción.
 */
const FORBIDDEN_ID_KEYS = new Set(['_id', 'catalog_version_id', 'source_id', 'context_item_id']);

export function assertRecord(value: unknown, label: string): asserts value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} debe ser un objeto JSON.`);
}

export function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} debe ser un arreglo JSON.`);
}

export function requireString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}.${key} debe ser un string no vacio.`);
  return value;
}

export function rejectImportedNumericIds(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectImportedNumericIds(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (FORBIDDEN_ID_KEYS.has(key)) throw new Error(`${label} contiene el identificador importado prohibido ${key}.`);
    rejectImportedNumericIds(child, `${label}.${key}`);
  }
}

export async function readJson<T>(path: string, label: string): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer ${label} (${path}).`, { cause: error });
  }
  assertRecord(parsed, label);
  return parsed as T;
}

export function resolvePackageFile(packageDirectory: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`El manifest contiene una ruta absoluta no permitida: ${relativePath}`);
  const root = resolve(packageDirectory);
  const path = resolve(root, normalize(relativePath));
  const pathFromRoot = relative(root, path);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) throw new Error(`La ruta sale del paquete: ${relativePath}`);
  return path;
}

export function validateHeader(record: JsonRecord, label: string): void {
  if (record.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion debe ser ${EXPECTED_SCHEMA_VERSION}.`);
  }
}

export function validateItem(
  item: unknown,
  expectedCatalogCode: string | undefined,
  expectedVersionCode: string | undefined,
  label: string,
): JsonRecord {
  assertRecord(item, label);
  rejectImportedNumericIds(item, label);
  const catalogCode = requireString(item, 'catalogCode', label);
  const versionCode = requireString(item, 'versionCode', label);
  requireString(item, 'itemCode', label);
  requireString(item, 'itemName', label);
  requireString(item, 'itemType', label);
  requireString(item, 'sourceCode', label);
  if (expectedCatalogCode && catalogCode !== expectedCatalogCode) throw new Error(`${label}.catalogCode no coincide con el chunk.`);
  if (expectedVersionCode && versionCode !== expectedVersionCode) throw new Error(`${label}.versionCode no coincide con el chunk.`);
  return item;
}
