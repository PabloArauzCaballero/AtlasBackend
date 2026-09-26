/**
 * @file Soporte de las pruebas de conformidad del consumidor Core → Motor (P-14).
 * @business Core puede probar su adaptador sin levantar el motor, contra el contrato que el motor
 *   publica: si el motor cambia de forma, esto falla aquí antes que en producción.
 * @system un validador mínimo del subconjunto OpenAPI versionado, un motor doble HTTP real y las
 *   respuestas que el motor construye en `runtime.service.ts` (commit en el fixture).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../../../../src/config/env.js';

type Schema = {
  $ref?: string;
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  maxLength?: number;
  minimum?: number;
  additionalProperties?: boolean | Schema;
};

type OpenApiSubset = {
  'x-atlas-source': { commit: string; file: string };
  paths: Record<string, Record<string, { requestBody?: { content: { 'application/json': { schema: Schema } } } }>>;
  components: { schemas: Record<string, Schema> };
};

/** El contrato del motor tal como se copió en Core, con el commit de origen en `x-atlas-source`. */
export const ENGINE_OPENAPI = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'engine-openapi.v1.json'), 'utf8'),
) as OpenApiSubset;

function resolve(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.split('/').pop() as string;
  const target = ENGINE_OPENAPI.components.schemas[name];
  if (!target) throw new Error(`El fixture no contiene el esquema ${name}`);
  return target;
}

/**
 * Valida un valor contra un esquema del fixture: tipos, obligatorios, enum, longitud y mínimo. No es
 * un validador OpenAPI completo; cubre lo que el motor declara en estos DTO, y falla ruidosamente si
 * aparece algo que no sabe comprobar.
 */
export function validate(schemaOrName: Schema | string, value: unknown, path = '$'): string[] {
  const schema = resolve(typeof schemaOrName === 'string' ? { $ref: `#/components/schemas/${schemaOrName}` } : schemaOrName);
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} fuera de ${JSON.stringify(schema.enum)}`);
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [...errors, `${path}: se esperaba objeto`];
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (record[key] === undefined) errors.push(`${path}.${key}: obligatorio`);
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (record[key] !== undefined) errors.push(...validate(sub, record[key], `${path}.${key}`));
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [...errors, `${path}: se esperaba lista`];
      value.forEach((item, index) => errors.push(...validate(schema.items ?? {}, item, `${path}[${index}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: se esperaba texto`);
      else if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: supera ${schema.maxLength}`);
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: se esperaba número`);
      else if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: menor que ${schema.minimum}`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: se esperaba booleano`);
      break;
    case undefined:
      break;
    default:
      throw new Error(`Tipo ${schema.type} no soportado por el validador de contrato`);
  }
  return errors;
}

/** El esquema del cuerpo de una operación del fixture. */
export function requestSchema(path: string, method = 'post'): Schema {
  const operation = ENGINE_OPENAPI.paths[path]?.[method];
  const schema = operation?.requestBody?.content['application/json'].schema;
  if (!schema) throw new Error(`El fixture no declara cuerpo para ${method.toUpperCase()} ${path}`);
  return schema;
}

export type Reply =
  | { status: number; body?: unknown; raw?: string; delayMs?: number }
  | ((request: RecordedRequest) => { status: number; body?: unknown; raw?: string; delayMs?: number });

export type RecordedRequest = { method: string; url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> };

/**
 * Un motor doble que habla HTTP de verdad: el transporte, los reintentos, el tiempo de espera y el
 * parseo del cuerpo son los reales de Core. Cada ruta responde con la cola de respuestas que se le
 * dé; la última se repite.
 */
export class EngineDouble {
  readonly requests: RecordedRequest[] = [];
  private readonly routes = new Map<string, Reply[]>();
  private server: Server | null = null;

  reply(path: string, ...replies: Reply[]): this {
    this.routes.set(path, replies);
    return this;
  }

  callsTo(path: string): RecordedRequest[] {
    return this.requests.filter((request) => request.url === path);
  }

  async start(): Promise<string> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((done) => this.server?.listen(0, '127.0.0.1', done));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((done) => (this.server ? this.server.close(() => done()) : done()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const recorded: RecordedRequest = {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: request.headers,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
    this.requests.push(recorded);
    const queue = this.routes.get(recorded.url) ?? [{ status: 404, body: problem(404, 'NOT_FOUND') }];
    const index = Math.min(this.callsTo(recorded.url).length - 1, queue.length - 1);
    const next = queue[index];
    const reply = typeof next === 'function' ? next(recorded) : next;
    if (reply.delayMs) await new Promise((done) => setTimeout(done, reply.delayMs));
    if (response.destroyed) return;
    response.statusCode = reply.status;
    response.setHeader('content-type', reply.raw !== undefined ? 'text/html' : 'application/json');
    response.end(reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body)));
  }
}

/** La respuesta de error uniforme del motor (`ProblemDetails`). */
export function problem(status: number, code: string, message = code): Record<string, unknown> {
  return {
    type: `https://atlas.local/errors/${code.toLowerCase()}`,
    title: code,
    status,
    requestId: '01J8ZQ2M5K9V3S7T1XW4YB6CDE',
    error: { code, message },
  };
}

const ENV_KEYS = [
  'DECISION_ENGINE_BASE_URL',
  'DECISION_ENGINE_API_KEY',
  'DECISION_ENGINE_OUTCOME_API_KEY',
  'DECISION_ENGINE_GOVERNANCE_API_KEY',
  'DECISION_ENGINE_TIMEOUT_MS',
  'DECISION_ENGINE_RETRIES',
  'DECISION_ENGINE_RETRY_BASE_DELAY_MS',
] as const;

/** Apunta el core al motor doble con llaves distintas por plano, y devuelve cómo restaurarlo. */
export function pointCoreAt(baseUrl: string, overrides: Partial<Record<(typeof ENV_KEYS)[number], unknown>> = {}): () => void {
  const mutable = env as unknown as Record<string, unknown>;
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, mutable[key]]));
  Object.assign(mutable, {
    DECISION_ENGINE_BASE_URL: baseUrl,
    DECISION_ENGINE_API_KEY: 'llave-runtime',
    DECISION_ENGINE_OUTCOME_API_KEY: 'llave-desenlaces',
    DECISION_ENGINE_GOVERNANCE_API_KEY: 'llave-gobierno',
    DECISION_ENGINE_TIMEOUT_MS: 400,
    DECISION_ENGINE_RETRIES: 1,
    DECISION_ENGINE_RETRY_BASE_DELAY_MS: 5,
    ...overrides,
  });
  return () => Object.assign(mutable, saved);
}
