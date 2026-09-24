/**
 * @file Validador del SUBCONJUNTO de JSON Schema 2020-12 que usa el contrato atlas-integration-v1.
 * @business Productor y consumidor se prueban contra el MISMO esquema, sin depender de una librería
 *   que el repositorio no declara (ajv sólo llega transitivo y en la versión 6, sin draft 2020-12).
 * @system Soporta type, enum, const, pattern, minLength, maxLength, minimum, maximum, required,
 *   properties, additionalProperties, items, minItems, oneOf y $ref (local y a otro archivo del
 *   contrato). Un esquema con una palabra clave que no conoce FALLA al validar: nunca la ignora en
 *   silencio. Hay una copia con la misma lógica en AtlasERPBackend (test/contracts/atlas-integration),
 *   formateada con el estilo de cada repositorio.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Schema = Record<string, unknown>;

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'oneOf',
  '$ref',
]);

export type SchemaRegistry = ReadonlyMap<string, Schema>;

/** Carga todos los `*.schema.json` de `<contrato>/schemas` indexados por nombre de archivo. */
export function loadSchemaRegistry(contractDir: string): SchemaRegistry {
  const dir = join(contractDir, 'schemas');
  const registry = new Map<string, Schema>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.schema.json'))) {
    registry.set(file, JSON.parse(readFileSync(join(dir, file), 'utf8')) as Schema);
  }
  return registry;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  return actual === expected || (expected === 'number' && actual === 'integer');
}

function resolveRef(ref: string, currentFile: string, registry: SchemaRegistry): { schema: Schema; file: string } {
  const [filePart, pointer = ''] = ref.split('#');
  const file = filePart ? filePart : currentFile;
  const root = registry.get(file);
  if (!root) throw new Error(`$ref a un esquema que no existe: ${ref}`);
  let node: unknown = root;
  for (const segment of pointer.split('/').filter(Boolean)) {
    node = (node as Record<string, unknown>)[segment];
    if (node === undefined) throw new Error(`$ref no resuelve: ${ref}`);
  }
  return { schema: node as Schema, file };
}

function check(value: unknown, schema: Schema, path: string, file: string, registry: SchemaRegistry, errors: string[]): void {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) throw new Error(`Palabra clave no soportada «${key}» en ${file}`);
  }
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, file, registry);
    check(value, target.schema, path, target.file, registry, errors);
  }
  if (schema.oneOf) {
    const matches = (schema.oneOf as Schema[]).filter((option) => {
      const nested: string[] = [];
      check(value, option, path, file, registry, nested);
      return nested.length === 0;
    }).length;
    if (matches !== 1) errors.push(`${path}: debe cumplir exactamente una alternativa de oneOf (cumple ${matches})`);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: se esperaba ${types.join('|')} y llegó ${typeOf(value)}`);
      return;
    }
  }
  if (schema.enum && !(schema.enum as unknown[]).some((option) => option === value)) errors.push(`${path}: fuera de enum`);
  if ('const' in schema && schema.const !== value) errors.push(`${path}: distinto de const`);
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value))
      errors.push(`${path}: no cumple ${schema.pattern}`);
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength)
      errors.push(`${path}: más corto que ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength)
      errors.push(`${path}: más largo que ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: menor que ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: mayor que ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      errors.push(`${path}: menos de ${schema.minItems} elementos`);
    if (schema.items) value.forEach((item, index) => check(item, schema.items as Schema, `${path}[${index}]`, file, registry, errors));
  }
  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in object)) errors.push(`${path}: falta «${key}»`);
    }
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const [key, nested] of Object.entries(object)) {
      if (properties[key]) check(nested, properties[key], `${path}.${key}`, file, registry, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: propiedad no permitida «${key}»`);
      else if (typeof schema.additionalProperties === 'object')
        check(nested, schema.additionalProperties as Schema, `${path}.${key}`, file, registry, errors);
    }
  }
}

/** Valida `value` contra el esquema `schemaFile` del registro. Devuelve la lista de errores (vacía = válido). */
export function validateAgainst(registry: SchemaRegistry, schemaFile: string, value: unknown): string[] {
  const schema = registry.get(schemaFile);
  if (!schema) throw new Error(`Esquema desconocido: ${schemaFile}`);
  const errors: string[] = [];
  check(value, schema, '$', schemaFile, registry, errors);
  return errors;
}

export type TopicEntry = {
  topic: string;
  schemaVersion: number;
  schema: string;
  family: string;
  producer: string;
  consumer: string | null;
};

/** Valida un sobre completo: primero el sobre, después el payload con el esquema de su tópico. */
export function validateEnvelope(registry: SchemaRegistry, topics: readonly TopicEntry[], envelope: unknown): string[] {
  const errors = validateAgainst(registry, 'envelope.schema.json', envelope);
  if (errors.length > 0) return errors;
  const { topic, payload } = envelope as { topic: string; payload: unknown };
  const entry = topics.find((candidate) => candidate.topic === topic);
  if (!entry) return [`tópico sin esquema en topics.json: ${topic}`];
  return validateAgainst(registry, entry.schema.replace(/^schemas\//u, ''), payload);
}
