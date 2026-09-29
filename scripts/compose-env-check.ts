/**
 * Compara los composes de despliegue con el esquema tipado de configuración.
 *
 * Lo que no está NOMBRADO en el `environment:` de un compose no existe dentro del contenedor, por mucho
 * que el operador lo ponga en Coolify o en el host: `TWILIO_*`, `FCM_*`, `MALWARE_SCAN_*`,
 * `EXPEDIENTES_*`… estaban en el esquema y en las plantillas `.env`, y no en `docker-compose.coolify.yml`
 * ni en `docker-compose.prod.yml`, así que en esos despliegues no había forma de encender SMS, push,
 * WhatsApp ni el envío de eventos al ERP. Y nombrarlas mal es peor: `${VAR:-}` entrega la cadena VACÍA,
 * que algunos campos rechazan (el contenedor no arranca) y otros leen distinto que la ausencia
 * (`MALWARE_SCAN_FAIL_CLOSED=""` es `false`, no el `true` por defecto).
 *
 * Tres comprobaciones por compose:
 *   1. Toda clave del esquema está nombrada, salvo las exentas (perillas numéricas con valor por defecto en
 *      el esquema, rutas por defecto, y una lista corta con su motivo).
 *   2. Lo que el compose entrega SIN que el operador ponga nada (el default, o la cadena vacía) pasa el
 *      esquema.
 *   3. Y significa lo mismo que la ausencia: si vacío y ausente dan valores distintos, hay que dar el
 *      valor explícito.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import type { ZodType } from 'zod';
import { envBaseSchema } from '../src/config/env.schema.js';

export const COMPOSE_FILES = ['docker-compose.coolify.yml', 'docker-compose.prod.yml'] as const;
export type ComposeFile = (typeof COMPOSE_FILES)[number];

type ExemptionMap = Record<string, string>;

/** Claves que ningún compose nombra, y por qué. Sólo entra aquí lo que de verdad no aplica. */
const EXEMPT_EVERYWHERE: ExemptionMap = {
  DB_APP_RW_PASSWORD: 'contraseña del rol que crea ops/postgres/bootstrap-roles.sql; la app usa DB_USER/DB_PASSWORD',
  DB_APP_RO_PASSWORD: 'contraseña del rol que crea ops/postgres/bootstrap-roles.sql; la app usa DB_READ_*',
  DB_MIGRATOR_PASSWORD: 'contraseña del rol que crea ops/postgres/bootstrap-roles.sql; el job migrate usa DB_MIGRATION_*',
  SYSTEM_TEST_ALLOWED_HOSTS_LOCAL: 'anfitriones de las pruebas de sistema desde el portal; tienen un valor por defecto seguro',
  SYSTEM_TEST_ALLOWED_HOSTS_STAGING: 'anfitriones de las pruebas de sistema desde el portal; vacío por defecto',
  SYSTEM_TEST_ALLOWED_HOSTS_PRODUCTION_READONLY: 'anfitriones de las pruebas de sistema desde el portal; vacío por defecto',
  FILE_STORAGE_LOCAL_ROOT: 'sólo se lee con FILE_STORAGE_ADAPTER=local, que un contenedor de disco efímero no debe usar',
  FILE_STORAGE_LOCAL_BASE_URL: 'sólo se lee con FILE_STORAGE_ADAPTER=local',
  FILE_STORAGE_LOCAL_URL_SECRET: 'sólo se lee con FILE_STORAGE_ADAPTER=local',
  FILE_STORAGE_MINIO_ENDPOINT: 'caen a STORAGE_S3_ENDPOINT: hay un solo MinIO por entorno',
  FILE_STORAGE_MINIO_PUBLIC_ENDPOINT: 'caen a STORAGE_S3_PUBLIC_ENDPOINT: hay un solo MinIO por entorno',
  FILE_STORAGE_MINIO_BUCKET: 'cae a STORAGE_S3_BUCKET: hay un solo MinIO por entorno',
  FILE_STORAGE_MINIO_REGION: 'cae a STORAGE_S3_REGION: hay un solo MinIO por entorno',
  FILE_STORAGE_MINIO_ACCESS_KEY_ID: 'cae a STORAGE_S3_ACCESS_KEY_ID: hay un solo MinIO por entorno',
  FILE_STORAGE_MINIO_SECRET_ACCESS_KEY: 'cae a STORAGE_S3_SECRET_ACCESS_KEY: hay un solo MinIO por entorno',
  FILE_STORAGE_MINIO_FORCE_PATH_STYLE: 'cae a STORAGE_S3_FORCE_PATH_STYLE: hay un solo MinIO por entorno',
  DB_READ_SSL:
    'booleano opcional: AUSENTE hereda DB_SSL (`env.DB_READ_SSL ?? env.DB_SSL`) y VACÍO es `false`; el compose sólo sabe entregar vacío',
  FLOWS_EXPOSE_SOURCE:
    'booleano opcional: AUSENTE sigue al entorno (`?? NODE_ENV !== production`) y VACÍO es `false`; el compose sólo sabe entregar vacío',
};

const QA_LAB_REASON = 'laboratorio QA y servidor de mocks: no se encienden en producción (los mocks se bloquean)';
const EXEMPT_PRODUCTION: ExemptionMap = {
  ...Object.fromEntries(
    [
      'QA_EXECUTION_ENABLED',
      'QA_EXECUTION_SECRET',
      'QA_TARGET_ENVIRONMENT_ID',
      'QA_TARGET_LABEL',
      'QA_TARGET_BASE_URL',
      'QA_TARGET_SHARES_DATABASE',
      'QA_INTERNAL_ACTOR_EMAIL',
      'QA_INTERNAL_ACTOR_PASSWORD',
      'MOCK_PROVIDERS_CONTROL_URL',
      'MOCK_PROVIDERS_CONTROL_TOKEN',
      'RUNTIME_JOBS_QA_CONSUMER_ENABLED',
      'EXTERNAL_PROVIDERS_MOCK_BASE_URL',
    ].map((key) => [key, QA_LAB_REASON]),
  ),
  DEV_ADMIN_EMAIL: 'usuarios de desarrollo: no existen en producción',
  DEV_ADMIN_PASSWORD: 'usuarios de desarrollo: no existen en producción',
  DEV_PARTNER_PASSWORD: 'usuarios de desarrollo: no existen en producción',
  MESSAGING_DB_USER: 'identidad del messaging-worker, que producción no despliega (el compose prod no tiene ese servicio)',
  MESSAGING_DB_PASSWORD: 'identidad del messaging-worker, que producción no despliega (el compose prod no tiene ese servicio)',
};

const EXEMPTIONS: Record<ComposeFile, ExemptionMap> = {
  'docker-compose.coolify.yml': EXEMPT_EVERYWHERE,
  'docker-compose.prod.yml': { ...EXEMPT_EVERYWHERE, ...EXEMPT_PRODUCTION },
};

type Shape = Record<string, ZodType>;
const SHAPE = (envBaseSchema as unknown as { shape: Shape }).shape;
export const SCHEMA_KEYS = Object.keys(SHAPE);

/** Lo que el esquema entrega cuando la clave no llega. */
function absentValue(key: string): { ok: boolean; data: unknown } {
  const result = SHAPE[key]!.safeParse(undefined);
  return { ok: result.success, data: result.success ? result.data : undefined };
}

/** Perilla numérica con valor por defecto en el esquema, o ruta por defecto: no necesita estar nombrada. */
export function exemptByNature(key: string): string | null {
  const absent = absentValue(key);
  if (absent.ok && typeof absent.data === 'number') return 'perilla numérica con valor por defecto en el esquema';
  if (absent.ok && typeof absent.data === 'string' && absent.data.startsWith('/')) return 'ruta por defecto en el esquema';
  return null;
}

/** Aplana `<<: *ancla` (js-yaml 5 no resuelve las claves de mezcla por sí solo): la mezcla va debajo de lo propio. */
function flatten(node: unknown): Record<string, unknown> {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return {};
  const { '<<': merged, ...own } = node as Record<string, unknown>;
  const bases = Array.isArray(merged) ? merged : merged === undefined ? [] : [merged];
  return Object.assign({}, ...bases.map(flatten), own);
}

/** Las claves del `environment:` de todos los servicios del compose, con las mezclas de ancla ya resueltas. */
export function composeEnvironment(source: string): Record<string, string> {
  const document = yaml.load(source) as { services?: Record<string, { environment?: unknown }> };
  const merged: Record<string, string> = {};
  for (const service of Object.values(document.services ?? {})) {
    for (const [key, value] of Object.entries(flatten(service.environment))) merged[key] = String(value ?? '');
  }
  return merged;
}

/**
 * Lo que llega al contenedor si el operador no pone nada: `${K:-def}` → `def`, `${K}` y `${K:-}` → vacío,
 * un literal → él mismo. `${K:?…}` (obligatoria) no tiene valor por omisión: devuelve `null`.
 */
export function valueWhenUnset(raw: string): string | null {
  const required = /^\$\{[A-Z0-9_]+:?\?/.test(raw);
  if (required) return null;
  const withDefault = /^\$\{[A-Z0-9_]+:?-(.*)\}$/s.exec(raw);
  if (withDefault) return withDefault[1]!;
  if (/^\$\{[A-Z0-9_]+\}$/.test(raw)) return '';
  return raw;
}

export type ComposeFinding = { file: string; message: string };

/** Los problemas de UN compose frente al esquema. `source` permite probar composes fabricados. */
export function checkCompose(file: ComposeFile, source: string): ComposeFinding[] {
  const findings: ComposeFinding[] = [];
  const environment = composeEnvironment(source);
  const exempt = EXEMPTIONS[file];

  const missing = SCHEMA_KEYS.filter((key) => !(key in environment) && !(key in exempt) && exemptByNature(key) === null);
  if (missing.length > 0) {
    findings.push({
      file,
      message:
        `no nombra ${missing.length} variable(s) del esquema, así que NO llegan al contenedor aunque el operador las ponga: ${missing.join(', ')}. ` +
        'Nómbralas en el ancla de entorno (con `${VAR:-valor real}` si el campo rechaza la cadena vacía) o, si de verdad no aplican, añádelas a la lista de exentas de scripts/compose-env-check.ts con su motivo.',
    });
  }

  const stale = Object.keys(exempt).filter((key) => key in environment);
  if (stale.length > 0) {
    findings.push({
      file,
      message: `la lista de exentas de scripts/compose-env-check.ts nombra variables que el compose YA nombra: ${stale.join(', ')}. Quítalas de la lista.`,
    });
  }

  for (const [key, raw] of Object.entries(environment)) {
    const schema = SHAPE[key];
    if (!schema) continue;
    const unset = valueWhenUnset(raw);
    if (unset === null) continue;
    const parsed = schema.safeParse(unset);
    if (!parsed.success) {
      findings.push({
        file,
        message: `${key}: sin valor del operador el compose entrega ${JSON.stringify(unset)} y el esquema lo rechaza (${parsed.error.issues[0]?.message}). Da un valor por defecto real en vez de la cadena vacía.`,
      });
      continue;
    }
    const absent = absentValue(key);
    // Una cadena opcional con «vacío» frente a «ausente» se lee igual (los dos son falsy): no cuenta. Cuenta
    // cuando la ausencia significa otra cosa que el vacío: un valor por defecto, o «no configurado» frente a `false`.
    if (unset === '' && absent.ok && parsed.data !== '' && JSON.stringify(parsed.data) !== JSON.stringify(absent.data)) {
      findings.push({
        file,
        message: `${key}: la cadena vacía se lee como ${JSON.stringify(parsed.data)} y la ausencia como ${JSON.stringify(absent.data)}. Escribe el valor explícito (\`\${${key}:-${String(absent.data)}}\`) para que no cambie el significado.`,
      });
    }
  }
  return findings;
}

export function checkComposeFiles(root: string = process.cwd()): ComposeFinding[] {
  return COMPOSE_FILES.flatMap((file) => checkCompose(file, readFileSync(resolve(root, file), 'utf8')));
}
