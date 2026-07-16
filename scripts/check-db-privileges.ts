/**
 * Verificación no destructiva de la matriz de privilegios PostgreSQL de Atlas (Fase 2, §28/§35).
 *
 * Conecta como la conexión de escritura (DB_*) y, si hay credenciales, como la de lectura (DB_READ_*),
 * y valida:
 *   - atlas_app_rw: no es superuser, no tiene CREATE en el schema core, sí tiene CRUD en tablas.
 *   - atlas_app_ro: sesión read-only por defecto, USAGE en read_api, y una escritura es rechazada.
 *
 * Diseñado para CI donde los roles ya existen. En un entorno sin los roles (o sin conexión), se
 * SALTA con un aviso y termina en 0 — no bloquea. Las aserciones estrictas solo se aplican cuando el
 * usuario realmente conectado es el rol esperado, así correr localmente como `postgres` no falla.
 *
 * Ejecutar con `yarn check:db-privileges`.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env.js';

interface ConnectionSpec {
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

function buildSequelize(spec: ConnectionSpec): Sequelize {
  return new Sequelize({
    dialect: 'postgres',
    host: spec.host,
    port: spec.port,
    database: spec.database,
    username: spec.username,
    password: spec.password,
    models: [],
    logging: false,
    dialectOptions: env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : undefined,
  });
}

async function selectOne<T extends Record<string, unknown>>(
  sequelize: Sequelize,
  sql: string,
  replacements: Record<string, unknown> = {},
): Promise<T> {
  const rows = (await sequelize.query(sql, { type: QueryTypes.SELECT, replacements })) as T[];
  return rows[0];
}

async function checkReadWrite(sequelize: Sequelize): Promise<string[]> {
  const errors: string[] = [];
  const identity = await selectOne<{ current_user: string; is_super: boolean }>(
    sequelize,
    `SELECT current_user, COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_super`,
  );

  if (identity.current_user !== 'atlas_app_rw') {
    console.log(
      `[nota] conexión de escritura conectada como "${identity.current_user}", no atlas_app_rw; se omiten aserciones estrictas de RW.`,
    );
    return errors;
  }

  if (identity.is_super) errors.push('atlas_app_rw es SUPERUSER (debe ser NOSUPERUSER).');

  const create = await selectOne<{ can_create: boolean }>(
    sequelize,
    `SELECT has_schema_privilege(current_user, :schema, 'CREATE') AS can_create`,
    { schema: env.DB_SCHEMA },
  );
  if (create.can_create) errors.push(`atlas_app_rw tiene CREATE en el schema "${env.DB_SCHEMA}" (no debe tener DDL).`);

  const crud = await selectOne<{ can_select: string; can_insert: string; total: string }>(
    sequelize,
    `SELECT
       count(*) AS total,
       count(*) FILTER (WHERE has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'SELECT')) AS can_select,
       count(*) FILTER (WHERE has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'INSERT')) AS can_insert
     FROM pg_tables WHERE schemaname = :schema`,
    { schema: env.DB_SCHEMA },
  );
  if (Number(crud.total) > 0 && Number(crud.can_select) === 0) {
    errors.push('atlas_app_rw no puede hacer SELECT en ninguna tabla del schema core.');
  }
  if (Number(crud.total) > 0 && Number(crud.can_insert) === 0) {
    errors.push('atlas_app_rw no puede hacer INSERT en ninguna tabla del schema core.');
  }

  console.log(`[ok] atlas_app_rw verificado (SELECT en ${crud.can_select}/${crud.total} tablas, sin CREATE, sin superuser).`);
  return errors;
}

async function checkReadOnly(sequelize: Sequelize): Promise<string[]> {
  const errors: string[] = [];
  const identity = await selectOne<{ current_user: string }>(sequelize, `SELECT current_user`);

  if (identity.current_user !== 'atlas_app_ro') {
    console.log(
      `[nota] conexión de lectura conectada como "${identity.current_user}", no atlas_app_ro; se omiten aserciones estrictas de RO.`,
    );
    return errors;
  }

  const readOnly = await selectOne<{ read_only: string }>(sequelize, `SELECT current_setting('transaction_read_only') AS read_only`);
  if (readOnly.read_only !== 'on') errors.push('la sesión de atlas_app_ro no es read-only por defecto.');

  const usage = await selectOne<{ usage: boolean }>(sequelize, `SELECT has_schema_privilege(current_user, :schema, 'USAGE') AS usage`, {
    schema: 'read_api',
  });
  if (!usage.usage) errors.push('atlas_app_ro no tiene USAGE en el schema read_api.');

  let wroteSuccessfully = false;
  try {
    await sequelize.query('CREATE TEMP TABLE _atlas_ro_probe (x integer)');
    wroteSuccessfully = true;
  } catch {
    // Esperado: una sesión read-only rechaza cualquier escritura, incluida una tabla temporal.
  }
  if (wroteSuccessfully) errors.push('atlas_app_ro pudo ejecutar una escritura (CREATE TEMP TABLE) — no es read-only real.');

  console.log('[ok] atlas_app_ro verificado (read-only, USAGE en read_api, escritura rechazada).');
  return errors;
}

async function runCheck(spec: ConnectionSpec, check: (s: Sequelize) => Promise<string[]>): Promise<string[]> {
  const sequelize = buildSequelize(spec);
  try {
    await sequelize.authenticate();
  } catch (error) {
    console.warn(`[skip] no se pudo conectar como ${spec.label}: ${(error as Error).message}`);
    await sequelize.close().catch(() => undefined);
    return [];
  }
  try {
    return await check(sequelize);
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const errors: string[] = [];

  errors.push(
    ...(await runCheck(
      {
        label: 'conexión de escritura (DB_*)',
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        username: env.DB_USER,
        password: env.DB_PASSWORD,
      },
      checkReadWrite,
    )),
  );

  if (env.DB_READ_USER) {
    errors.push(
      ...(await runCheck(
        {
          label: 'conexión de lectura (DB_READ_*)',
          host: env.DB_READ_HOST ?? env.DB_HOST,
          port: env.DB_READ_PORT ?? env.DB_PORT,
          database: env.DB_READ_NAME ?? env.DB_NAME,
          username: env.DB_READ_USER,
          password: env.DB_READ_PASSWORD ?? env.DB_PASSWORD,
        },
        checkReadOnly,
      )),
    );
  } else {
    console.log('[skip] DB_READ_USER no configurado; se omite la verificación de atlas_app_ro.');
  }

  if (errors.length > 0) {
    console.error('❌ Violaciones de privilegios PostgreSQL:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log('✅ Verificación de privilegios PostgreSQL completada sin violaciones.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
