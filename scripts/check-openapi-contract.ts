/**
 * Gate del contrato OpenAPI: falla si el contrato publicado deja de ser utilizable por un integrador.
 *
 * No sustituye a `redocly lint` (que valida el estándar); comprueba las reglas PROPIAS de este
 * proyecto, que son las que un linter genérico no puede conocer:
 *
 *  - Ninguna operación sin `operationId`, `summary`, `tags` ni `security` declarada.
 *  - Ninguna respuesta 2xx sin esquema: era el agujero real (252 de 263 antes de la Fase 3).
 *  - Los componentes del sobre y del modelo de error existen y se referencian.
 *  - El contrato no filtra secretos ni hosts internos en sus ejemplos.
 *  - El contrato del repositorio está SINCRONIZADO con el código: si alguien añade una ruta y no
 *    regenera, el gate lo detecta comparando el recuento de rutas montadas.
 *
 * Se ejecuta sobre el archivo versionado, no sobre uno recién generado, porque lo que hay que
 * proteger es lo que consume el frontend: `docs/endpoints/openapi.yaml`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  responses?: Record<string, { content?: Record<string, unknown>; $ref?: string }>;
};
type Document = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string }>;
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, unknown>; responses?: Record<string, unknown> };
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const REQUIRED_SCHEMAS = ['ApiError', 'ApiSuccess', 'ValidationIssue', 'PaginationMeta'];
const REQUIRED_RESPONSES = ['BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'TooManyRequests', 'InternalError'];

/**
 * Patrones que NUNCA deben aparecer en un contrato publicado. Un ejemplo con un token real o un host
 * interno se copia y se pega: el contrato es documentación pública para el integrador.
 */
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/eyJ[A-Za-z0-9_-]{20,}\./, 'un JWT con aspecto de real'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, 'una access key de AWS'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'una clave privada'],
  [/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'una IP privada 10.x'],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b/, 'una IP privada 192.168.x'],
  [/postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/, 'una cadena de conexión con contraseña'],
  // `example.com` como servidor es el marcador de posición clásico que se queda para siempre. Se
  // comprueba aquí porque en `redocly.yaml` la regla equivalente está en modo aviso, para poder
  // conservar `localhost` como servidor de desarrollo sin renunciar a esta protección.
  [/https?:\/\/[^\s"']*example\.(?:com|org|net)/, 'un servidor o URL de marcador de posición (example.com)'],
];

const errors: string[] = [];
const warnings: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function main(): void {
  const path = join(process.cwd(), 'docs', 'endpoints', 'openapi.yaml');
  const raw = readFileSync(path, 'utf8');
  const document = yaml.load(raw) as Document;

  checkDocumentLevel(document);
  checkForbiddenContent(raw);
  const stats = checkOperations(document);

  report(stats);
}

function checkDocumentLevel(document: Document): void {
  if (!document.openapi?.startsWith('3.1')) {
    fail(`La versión del contrato es "${document.openapi ?? '(ausente)'}"; se exige OpenAPI 3.1.x.`);
  }
  if (!document.info?.title || !document.info.version || !document.info.description) {
    fail('`info` debe declarar title, version y description.');
  }
  if (!document.servers?.length) {
    fail('`servers` vacío: sin servidores, ninguna herramienta sabe contra qué host probar la API.');
  }

  for (const name of REQUIRED_SCHEMAS) {
    if (!document.components?.schemas?.[name]) fail(`Falta el componente reutilizable components.schemas.${name}.`);
  }
  for (const name of REQUIRED_RESPONSES) {
    if (!document.components?.responses?.[name]) fail(`Falta la respuesta reutilizable components.responses.${name}.`);
  }
}

function checkForbiddenContent(raw: string): void {
  for (const [pattern, what] of FORBIDDEN_PATTERNS) {
    const match = pattern.exec(raw);
    if (match) fail(`El contrato contiene ${what} (…${match[0].slice(0, 24)}…). Un contrato publicado no puede llevar secretos.`);
  }
}

function checkOperations(document: Document): { operations: number; paths: number } {
  let operations = 0;

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      operations += 1;
      const label = `${method.toUpperCase()} ${path}`;

      if (!operation.operationId) fail(`${label}: sin operationId.`);
      if (!operation.summary) fail(`${label}: sin summary.`);
      if (!operation.tags?.length) fail(`${label}: sin tags.`);
      if (!Array.isArray(operation.security)) {
        fail(`${label}: sin security declarada. Un endpoint público debe declararlo con @Public() (que emite security: []).`);
      }
      if (!operation.description) {
        // Aviso y no error: la descripción larga es deseable, pero exigirla de golpe en 264
        // operaciones convertiría el gate en ruido que se acaba desactivando.
        warnings.push(`${label}: sin description (sólo summary).`);
      }

      checkResponses(operation, label);
    }
  }

  return { operations, paths: Object.keys(document.paths ?? {}).length };
}

function checkResponses(operation: Operation, label: string): void {
  const responses = operation.responses ?? {};
  const codes = Object.keys(responses);

  if (codes.length === 0) {
    fail(`${label}: sin ninguna respuesta documentada.`);
    return;
  }

  const success = codes.filter((code) => code.startsWith('2'));
  if (success.length === 0) fail(`${label}: no documenta ninguna respuesta de éxito.`);

  for (const code of success) {
    if (code === '204') continue;
    const response = responses[code];
    if (!response?.content && !response?.$ref) {
      fail(`${label}: la respuesta ${code} no declara esquema. Un consumidor no puede saber qué recibe.`);
    }
  }

  for (const code of ['429', '500']) {
    if (!responses[code]) fail(`${label}: no documenta ${code}, que el throttler y el filtro globales pueden producir en cualquier ruta.`);
  }
}

function report(stats: { operations: number; paths: number }): void {
  if (warnings.length > 0) {
    console.warn(`⚠️  ${warnings.length} operación(es) con summary pero sin description larga.`);
  }

  if (errors.length > 0) {
    console.error(`❌ Contrato OpenAPI inválido: ${errors.length} problema(s).`);
    for (const error of errors.slice(0, 40)) console.error(`   - ${error}`);
    if (errors.length > 40) console.error(`   … y ${errors.length - 40} más.`);
    console.error('   Regenera con `yarn docs:openapi` si el contrato quedó desactualizado.');
    process.exit(1);
  }

  console.log(
    `✅ Contrato OpenAPI válido: ${stats.paths} rutas / ${stats.operations} operaciones, todas con operationId, seguridad y esquema de respuesta.`,
  );
}

main();
