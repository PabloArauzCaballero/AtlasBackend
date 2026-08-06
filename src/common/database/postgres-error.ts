/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza convierte fallos del motor en respuestas comprensibles sin filtrar detalles internos.
 * @system traduce SQLSTATE de PostgreSQL a una clasificación estable de infraestructura.
 */
import { HttpStatus } from '@nestjs/common';

/**
 * Normalización de errores PostgreSQL (§33 del plan de persistencia).
 *
 * Motivación: hasta ahora cada módulo interceptaba `UniqueConstraintError` por su cuenta. Eso solo
 * cubre el camino del ORM: una consulta cruda (`ReadQueryService`, repositorios con
 * `sequelize.query`) devuelve el error del driver `pg` sin envolver, y terminaba como un 500
 * genérico. Peor aún, dos fallos que son *nuestros* —`42501` (al rol le falta un privilegio) y
 * `25006` (alguien intentó escribir por la conexión read-only)— se veían igual que cualquier otro
 * error interno, justo los dos síntomas que la separación read/write existe para detectar.
 *
 * Este módulo es deliberadamente puro: no lanza, no loguea y no conoce HTTP más allá del código de
 * estado sugerido. Quien decide qué hacer es el filtro global.
 */

/** Clasificación estable e independiente del driver. Es lo que consumen filtros y observabilidad. */
export type PostgresFailureKind =
  | 'duplicate_entity'
  | 'foreign_key_conflict'
  | 'required_field'
  | 'check_violation'
  | 'serialization_conflict'
  | 'deadlock_detected'
  | 'insufficient_privilege'
  | 'read_only_transaction'
  | 'query_timeout'
  | 'too_many_connections'
  | 'connection_unavailable';

export interface NormalizedPostgresError {
  kind: PostgresFailureKind;
  /** SQLSTATE crudo. Solo para logs/métricas internas: nunca viaja al cliente. */
  sqlState: string;
  /** Estado HTTP sugerido para el contrato público. */
  httpStatus: number;
  /** Mensaje saneado, sin nombres de tabla/columna ni valores (son PII en un backend KYC). */
  clientMessage: string;
  /** ¿Reintentar la misma operación tiene sentido? Útil para clientes y para políticas de retry. */
  retryable: boolean;
  /**
   * `true` cuando el fallo delata un problema NUESTRO (grants mal aplicados, enrutamiento
   * read/write incorrecto, pool agotado) y no una entrada inválida del cliente. Estos casos deben
   * alertar aunque la respuesta HTTP sea un 5xx genérico.
   */
  operatorFault: boolean;
}

/** Class 08 — connection exception. Se trata por prefijo: el catálogo completo es largo y estable. */
const CONNECTION_EXCEPTION_CLASS = '08';

const FAILURES: Record<string, Omit<NormalizedPostgresError, 'sqlState'>> = {
  // --- Violaciones de integridad: entrada del cliente, 4xx -------------------------------------
  '23505': {
    kind: 'duplicate_entity',
    httpStatus: HttpStatus.CONFLICT,
    clientMessage: 'El recurso ya existe o viola una restricción única.',
    retryable: false,
    operatorFault: false,
  },
  '23503': {
    kind: 'foreign_key_conflict',
    httpStatus: HttpStatus.CONFLICT,
    clientMessage: 'La operación referencia un recurso inexistente o que aún está en uso.',
    retryable: false,
    operatorFault: false,
  },
  '23502': {
    kind: 'required_field',
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    clientMessage: 'Falta un campo obligatorio para completar la operación.',
    retryable: false,
    operatorFault: false,
  },
  '23514': {
    kind: 'check_violation',
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    clientMessage: 'La operación viola una regla de validación de datos.',
    retryable: false,
    operatorFault: false,
  },

  // --- Concurrencia: nadie hizo nada mal, reintentar es la respuesta correcta -------------------
  '40001': {
    kind: 'serialization_conflict',
    httpStatus: HttpStatus.CONFLICT,
    clientMessage: 'La operación entró en conflicto con otra concurrente. Vuelve a intentarlo.',
    retryable: true,
    operatorFault: false,
  },
  '40P01': {
    kind: 'deadlock_detected',
    httpStatus: HttpStatus.CONFLICT,
    clientMessage: 'La operación entró en conflicto con otra concurrente. Vuelve a intentarlo.',
    retryable: true,
    operatorFault: false,
  },

  // --- Fallos NUESTROS: el cliente ve un 5xx opaco, nosotros vemos la causa exacta --------------
  //
  // 42501 se mapea a 500 y NO a 403 a propósito: que a `atlas_app_rw` le falte un GRANT no significa
  // que el usuario de la API no esté autorizado. Devolver 403 mentiría al cliente y escondería un
  // fallo de aprovisionamiento detrás de un error de negocio plausible.
  '42501': {
    kind: 'insufficient_privilege',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    clientMessage: 'Error interno no controlado.',
    retryable: false,
    operatorFault: true,
  },
  // 25006 es la señal de que una escritura salió por la conexión de LECTURA (atlas_app_ro fuerza
  // default_transaction_read_only). Es exactamente la violación de CQRS que la separación busca
  // cazar: nunca es culpa del cliente y nunca debe reintentarse.
  '25006': {
    kind: 'read_only_transaction',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    clientMessage: 'Error interno no controlado.',
    retryable: false,
    operatorFault: true,
  },

  // --- Capacidad y tiempo -----------------------------------------------------------------------
  '57014': {
    kind: 'query_timeout',
    httpStatus: HttpStatus.GATEWAY_TIMEOUT,
    clientMessage: 'La operación tardó demasiado y fue cancelada.',
    retryable: true,
    operatorFault: true,
  },
  '53300': {
    kind: 'too_many_connections',
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    clientMessage: 'El servicio no puede atender la petición en este momento.',
    retryable: true,
    operatorFault: true,
  },
};

const CONNECTION_UNAVAILABLE: Omit<NormalizedPostgresError, 'sqlState'> = {
  kind: 'connection_unavailable',
  httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
  clientMessage: 'El servicio no puede atender la petición en este momento.',
  retryable: true,
  operatorFault: true,
};

/** Profundidad máxima al desenvolver `original`/`parent`: evita ciclos y cadenas patológicas. */
const MAX_UNWRAP_DEPTH = 5;

function readCode(candidate: unknown): string | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const code = (candidate as { code?: unknown }).code;
  // El driver `pg` expone SQLSTATE en `code` como string de 5 caracteres. Los errores de red de
  // Node también usan `code` (`ECONNREFUSED`), de ahí la comprobación de forma y no solo de tipo.
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/**
 * Extrae el SQLSTATE de un error, atravesando el envoltorio de Sequelize.
 *
 * Sequelize expone el error del driver en `original` (y en `parent`, que apunta al mismo objeto).
 * Un error crudo de `pg` trae el código en la raíz.
 */
export function extractSqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH && current !== null && current !== undefined; depth += 1) {
    const code = readCode(current);
    if (code) return code;
    const next = (current as { original?: unknown }).original ?? (current as { parent?: unknown }).parent;
    if (next === current) break;
    current = next;
  }
  return null;
}

/**
 * Clasifica un SQLSTATE conocido. Devuelve `null` para códigos que no modelamos: el llamador debe
 * tratarlos como un error interno genérico en vez de inventar una semántica.
 */
export function classifySqlState(sqlState: string): NormalizedPostgresError | null {
  const known = FAILURES[sqlState];
  if (known) return { ...known, sqlState };
  if (sqlState.startsWith(CONNECTION_EXCEPTION_CLASS)) return { ...CONNECTION_UNAVAILABLE, sqlState };
  return null;
}

/** Atajo de conveniencia: extrae y clasifica en un paso. `null` si no es un error PostgreSQL conocido. */
export function normalizePostgresError(error: unknown): NormalizedPostgresError | null {
  const sqlState = extractSqlState(error);
  return sqlState === null ? null : classifySqlState(sqlState);
}
