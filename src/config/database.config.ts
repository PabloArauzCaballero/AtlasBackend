/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { SequelizeModuleOptions } from '@nestjs/sequelize';
import { env } from './env.js';
import { ATLAS_MIGRATION_SEARCH_PATH, ATLAS_RUNTIME_SEARCH_PATH } from '../database/domain-schemas.js';

function buildDialectOptions(
  useSsl: boolean,
  rejectUnauthorized: boolean,
  searchPath: readonly string[],
): SequelizeModuleOptions['dialectOptions'] {
  return {
    options: `-c search_path=${searchPath.join(',')}`,
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
    logging: env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: env.DB_POOL_MAX,
      min: env.DB_POOL_MIN,
      acquire: env.DB_POOL_ACQUIRE_MS,
      idle: env.DB_POOL_IDLE_MS,
    },
    dialectOptions: buildDialectOptions(env.DB_SSL, env.DB_SSL_REJECT_UNAUTHORIZED, ATLAS_RUNTIME_SEARCH_PATH),
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
    dialectOptions: buildDialectOptions(useSsl, env.DB_SSL_REJECT_UNAUTHORIZED, ['read_api', 'public']),
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
