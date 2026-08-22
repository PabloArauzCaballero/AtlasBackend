/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { Logger } from '@nestjs/common';
import { SequelizeModuleOptions } from '@nestjs/sequelize';
import { env } from './env.js';
import { redactSensitiveText } from '../common/utils/privacy/redact-text.util.js';
import { ATLAS_MIGRATION_SEARCH_PATH, ATLAS_RUNTIME_SEARCH_PATH } from '../database/domain-schemas.js';

const sqlLogger = new Logger('Sequelize');

/**
 * ATLAS-PERF-004 / ATLAS-SEC-012 — el volcado de SQL deja de colgar de `NODE_ENV`.
 *
 * `logging: env.NODE_ENV === 'development' ? console.log : false` convertía "estoy en desarrollo" en
 * "publica cada sentencia con sus valores inlineados". En un backend KYC eso son nombre, correo,
 * teléfono y número de documento en claro en stdout, en `Archivo.log` y en el espejo de MongoDB que
 * expone `/systems/logs/mongo` — contra la regla explícita del proyecto («Nunca loguear SQL»).
 *
 * Tres cambios: (1) es una decisión propia (`DB_LOG_SQL`), no un efecto colateral del entorno;
 * (2) está apagada por defecto, así que el desarrollador que la quiera la enciende a conciencia;
 * (3) cuando está encendida el SQL pasa por `redactSensitiveText` y por el logger de Nest en vez de
 * `console.log`, de modo que al menos las claves reconocibles (`password=`, `token:`, correos) salen
 * enmascaradas. La redacción REDUCE la exposición pero no la elimina —Sequelize inlinea valores
 * posicionales sin nombre— y por eso `env-cross-checks.ts` prohíbe activarla en producción.
 */
function sqlLogging(): ((sql: string) => void) | false {
  if (!env.DB_LOG_SQL) return false;
  return (sql: string) => sqlLogger.debug(redactSensitiveText(sql));
}

/**
 * Opciones de arranque de la SESIÓN de Postgres, en el formato `-c clave=valor` que `pg` pasa al
 * servidor al conectar.
 *
 * Además del `search_path`, aquí se fijan los dos techos que sólo el servidor puede aplicar:
 *
 * - `statement_timeout`: aborta una sentencia que excede el plazo. Es la única defensa real contra
 *   una consulta colgada reteniendo su conexión del pool. `RequestTimeoutInterceptor` corta el
 *   Observable del request y devuelve 503, pero la consulta subyacente sigue viva y la conexión
 *   sigue ocupada: sin este techo, N peticiones lentas agotan el pool aunque todas hayan respondido.
 * - `idle_in_transaction_session_timeout`: aborta una transacción abierta pero inactiva. Cubre el
 *   caso en que el cliente muere entre el `BEGIN` y el `COMMIT` y deja locks tomados sobre filas
 *   que nadie más puede tocar.
 *
 * `0` desactiva cada uno (el comportamiento previo a este cambio). Se aplican al runtime, no a la
 * conexión de migraciones: un DDL o un backfill legítimo puede durar mucho más que cualquier
 * consulta de una petición, y matarlo a la mitad es peor que dejarlo terminar.
 */
function sessionStartupOptions(searchPath: readonly string[], timeouts: { statementMs: number; idleInTransactionMs: number }): string {
  const parts = [`-c search_path=${searchPath.join(',')}`];
  if (timeouts.statementMs > 0) parts.push(`-c statement_timeout=${timeouts.statementMs}`);
  if (timeouts.idleInTransactionMs > 0) parts.push(`-c idle_in_transaction_session_timeout=${timeouts.idleInTransactionMs}`);
  return parts.join(' ');
}

function buildDialectOptions(
  useSsl: boolean,
  rejectUnauthorized: boolean,
  searchPath: readonly string[],
  timeouts: { statementMs: number; idleInTransactionMs: number } = { statementMs: 0, idleInTransactionMs: 0 },
): SequelizeModuleOptions['dialectOptions'] {
  return {
    options: sessionStartupOptions(searchPath, timeouts),
    ...(useSsl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized,
          },
        }
      : {}),
  };
}

/** Techos de sesión del RUNTIME (no de migraciones). Ver `sessionStartupOptions`. */
function runtimeSessionTimeouts(): { statementMs: number; idleInTransactionMs: number } {
  return { statementMs: env.DB_STATEMENT_TIMEOUT_MS, idleInTransactionMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS };
}

/**
 * Conexión de ESCRITURA / default del backend. Apúntala a `atlas_app_rw` (ver
 * `docs/database/postgres-roles.md`). Las migraciones deben correr con `atlas_migrator`, no con este
 * usuario runtime.
 */
export function buildSequelizeOptions(): SequelizeModuleOptions {
  return {
    dialect: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    schema: env.DB_SCHEMA,
    autoLoadModels: false,
    synchronize: false,
    logging: sqlLogging(),
    pool: {
      max: env.DB_POOL_MAX,
      min: env.DB_POOL_MIN,
      acquire: env.DB_POOL_ACQUIRE_MS,
      idle: env.DB_POOL_IDLE_MS,
    },
    dialectOptions: buildDialectOptions(env.DB_SSL, env.DB_SSL_REJECT_UNAUTHORIZED, ATLAS_RUNTIME_SEARCH_PATH, runtimeSessionTimeouts()),
  };
}

/**
 * Conexión de LECTURA opcional (Fase 5). Apúntala a `atlas_app_ro` y, en el futuro, a una réplica.
 * Cualquier campo `DB_READ_*` ausente cae al valor de la conexión de escritura equivalente, de modo
 * que cuando `DB_READ_ENABLED=false` esta conexión apunta al mismo primario con las credenciales de
 * escritura (degradación explícita, nunca silenciosa: el módulo read registra el modo activo).
 *
 * No registra modelos: el pool read se usa solo para queries SQL sobre vistas de `read_api`, así se
 * evita que alguien intente `save()` un modelo por el pool read-only.
 */
export function buildReadSequelizeOptions(): SequelizeModuleOptions {
  const useSsl = env.DB_READ_SSL ?? env.DB_SSL;
  return {
    dialect: 'postgres',
    host: env.DB_READ_HOST ?? env.DB_HOST,
    port: env.DB_READ_PORT ?? env.DB_PORT,
    database: env.DB_READ_NAME ?? env.DB_NAME,
    username: env.DB_READ_USER ?? env.DB_USER,
    password: env.DB_READ_PASSWORD ?? env.DB_PASSWORD,
    schema: env.DB_READ_SCHEMA ?? env.DB_SCHEMA,
    models: [],
    autoLoadModels: false,
    synchronize: false,
    logging: false,
    pool: {
      max: env.DB_READ_POOL_MAX,
      min: env.DB_POOL_MIN,
      acquire: env.DB_POOL_ACQUIRE_MS,
      idle: env.DB_POOL_IDLE_MS,
    },
    dialectOptions: buildDialectOptions(useSsl, env.DB_SSL_REJECT_UNAUTHORIZED, ['read_api', 'public'], runtimeSessionTimeouts()),
  };
}

/** True cuando el pool read apunta a un host/usuario distinto del de escritura (no es degradación). */
export function isDedicatedReadConnection(): boolean {
  return env.DB_READ_ENABLED && Boolean(env.DB_READ_HOST ?? env.DB_READ_USER);
}

/**
 * Conexión para MIGRACIONES y SEEDS (DDL).
 *
 * El runtime debe correr como `atlas_app_rw`, que deliberadamente NO puede alterar el schema. Si
 * migraciones y runtime compartieran identidad, ese privilegio mínimo sería ficticio. Por eso, cuando
 * `DB_MIGRATION_USER` está configurado, `db:migration:*` y `db:seed:*` usan esa identidad
 * (`atlas_migrator`) en vez de la del runtime. Si no está, cae a DB_USER — cómodo en local antes de
 * separar roles. Ver `docs/database/postgres-roles.md`.
 */
export function buildMigrationSequelizeOptions(): SequelizeModuleOptions {
  return {
    ...buildSequelizeOptions(),
    username: env.DB_MIGRATION_USER ?? env.DB_USER,
    password: env.DB_MIGRATION_PASSWORD ?? env.DB_PASSWORD,
    // `public` primero permite reproducir el historial previo a la migración de separación; una vez
    // movidas las tablas, los siguientes nombres se resuelven por dominio para seeds heredados.
    dialectOptions: buildDialectOptions(env.DB_SSL, env.DB_SSL_REJECT_UNAUTHORIZED, ATLAS_MIGRATION_SEARCH_PATH),
  };
}

/** True cuando las migraciones corren con una identidad distinta a la del runtime. */
export function usesDedicatedMigrationIdentity(): boolean {
  return Boolean(env.DB_MIGRATION_USER && env.DB_MIGRATION_USER !== env.DB_USER);
}
