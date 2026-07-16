import { SequelizeModuleOptions } from '@nestjs/sequelize';
import { env } from './env.js';

function buildSslOptions(useSsl: boolean, rejectUnauthorized: boolean): SequelizeModuleOptions['dialectOptions'] {
  return useSsl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized,
        },
      }
    : undefined;
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
    dialectOptions: buildSslOptions(env.DB_SSL, env.DB_SSL_REJECT_UNAUTHORIZED),
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
    dialectOptions: buildSslOptions(useSsl, env.DB_SSL_REJECT_UNAUTHORIZED),
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
  };
}

/** True cuando las migraciones corren con una identidad distinta a la del runtime. */
export function usesDedicatedMigrationIdentity(): boolean {
  return Boolean(env.DB_MIGRATION_USER && env.DB_MIGRATION_USER !== env.DB_USER);
}
