/**
 * Crea/actualiza la jerarquía de roles PostgreSQL de Atlas **usando el ORM** (Sequelize) en vez de
 * exigir `psql` + un DBA. Es el equivalente ejecutable de `ops/postgres/bootstrap-roles.sql` +
 * `grants.sql`, pensado para que un entorno local/CI quede con privilegio mínimo con un comando.
 *
 *   atlas_owner     -> propietario lógico, SIN LOGIN.
 *   atlas_migrator  -> aplica migraciones/seeds (DDL). Miembro de atlas_owner.
 *   atlas_app_rw    -> RUNTIME del backend: CRUD, sin DDL, sin TRUNCATE, sin ownership.
 *   atlas_app_ro    -> lecturas puras: read-only por defecto, solo vistas de read_api.
 *
 * Uso:
 *   # contraseñas desde tu gestor de secretos; NUNCA se versionan
 *   DB_APP_RW_PASSWORD=... DB_APP_RO_PASSWORD=... yarn db:roles:bootstrap
 *
 * Se conecta con DB_ADMIN_USER/DB_ADMIN_PASSWORD (cae a DB_USER/DB_PASSWORD). Esa identidad necesita
 * CREATE ROLE (superuser o rol con CREATEROLE); si no lo tiene, el script lo dice y termina sin
 * tocar nada, porque los roles son objetos de CLUSTER y muchos proveedores administrados restringen
 * su creación.
 *
 * Idempotente: se puede re-ejecutar; solo crea lo que falta y re-aplica grants.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../src/config/env.js';

const OWNER = 'atlas_owner';
const MIGRATOR = 'atlas_migrator';
const APP_RW = 'atlas_app_rw';
const APP_RO = 'atlas_app_ro';
const READ_SCHEMA = 'read_api';

function adminConnection(): Sequelize {
  return new Sequelize({
    dialect: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_ADMIN_USER ?? env.DB_USER,
    password: env.DB_ADMIN_PASSWORD ?? env.DB_PASSWORD,
    models: [],
    logging: false,
    dialectOptions: env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : undefined,
  });
}

async function roleExists(sequelize: Sequelize, role: string): Promise<boolean> {
  const rows = (await sequelize.query(`SELECT 1 AS ok FROM pg_roles WHERE rolname = :role`, {
    type: QueryTypes.SELECT,
    replacements: { role },
  })) as { ok: number }[];
  return rows.length > 0;
}

/**
 * Los nombres de rol son constantes de este archivo (no entrada de usuario), así que interpolarlos
 * es seguro. Las CONTRASEÑAS sí son entrada: se escapan como literal SQL con `sequelize.escape()`
 * porque PostgreSQL no admite parámetros ligados en sentencias DDL como `ALTER ROLE ... PASSWORD`.
 */
async function ensureRole(sequelize: Sequelize, role: string, attributes: string, password?: string): Promise<'creado' | 'actualizado'> {
  const existed = await roleExists(sequelize, role);
  if (!existed) await sequelize.query(`CREATE ROLE ${role}`);
  await sequelize.query(`ALTER ROLE ${role} WITH ${attributes}`);
  if (password) await sequelize.query(`ALTER ROLE ${role} PASSWORD ${sequelize.escape(password)}`);
  return existed ? 'actualizado' : 'creado';
}

async function main(): Promise<void> {
  const appRwPassword = env.DB_APP_RW_PASSWORD;
  const appRoPassword = env.DB_APP_RO_PASSWORD;

  if (!appRwPassword || !appRoPassword) {
    console.error('❌ Faltan contraseñas. Exporta DB_APP_RW_PASSWORD y DB_APP_RO_PASSWORD antes de ejecutar.');
    console.error(
      '   No existe un valor por defecto a propósito: una contraseña de repuesto en código equivale a una credencial filtrada.',
    );
    process.exit(1);
  }

  const sequelize = adminConnection();
  try {
    await sequelize.authenticate();
  } catch (error) {
    console.error(`❌ No se pudo conectar como identidad administrativa: ${(error as Error).message}`);
    process.exit(1);
  }

  try {
    const [identity] = (await sequelize.query(
      `SELECT current_user AS usr, current_database() AS db,
              COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_super,
              COALESCE((SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user), false) AS can_create_role`,
      { type: QueryTypes.SELECT },
    )) as { usr: string; db: string; is_super: boolean; can_create_role: boolean }[];

    if (!identity.is_super && !identity.can_create_role) {
      console.error(`❌ "${identity.usr}" no puede crear roles (ni superuser ni CREATEROLE).`);
      console.error('   Los roles son objetos de CLUSTER. Configura DB_ADMIN_USER/DB_ADMIN_PASSWORD con una identidad');
      console.error('   con CREATEROLE, o aplica ops/postgres/bootstrap-roles.sql con tu DBA/Terraform.');
      process.exit(1);
    }

    console.log(`Conectado como "${identity.usr}" en "${identity.db}" (superuser=${identity.is_super}).\n`);

    // --- Roles -------------------------------------------------------------------------------
    const base = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
    console.log(`${OWNER.padEnd(15)} ${await ensureRole(sequelize, OWNER, `NOLOGIN ${base}`)}`);
    console.log(
      `${MIGRATOR.padEnd(15)} ${await ensureRole(sequelize, MIGRATOR, `LOGIN ${base} CONNECTION LIMIT 3`, env.DB_MIGRATOR_PASSWORD)}`,
    );
    console.log(`${APP_RW.padEnd(15)} ${await ensureRole(sequelize, APP_RW, `LOGIN ${base} CONNECTION LIMIT 50`, appRwPassword)}`);
    console.log(`${APP_RO.padEnd(15)} ${await ensureRole(sequelize, APP_RO, `LOGIN ${base} CONNECTION LIMIT 25`, appRoPassword)}`);

    await sequelize.query(`GRANT ${OWNER} TO ${MIGRATOR}`);

    // El rol de solo lectura fuerza transacciones read-only y timeouts defensivos a nivel de rol:
    // así una consulta de BI no puede escribir ni quedarse colgada aunque el código lo intente.
    await sequelize.query(`ALTER ROLE ${APP_RO} SET default_transaction_read_only = on`);
    await sequelize.query(`ALTER ROLE ${APP_RO} SET statement_timeout = '5s'`);
    await sequelize.query(`ALTER ROLE ${APP_RO} SET idle_in_transaction_session_timeout = '15s'`);
    await sequelize.query(`ALTER ROLE ${APP_RO} SET lock_timeout = '1s'`);

    // --- Grants ------------------------------------------------------------------------------
    const core = env.DB_SCHEMA;
    await sequelize.query(`GRANT CONNECT ON DATABASE "${identity.db}" TO ${APP_RW}, ${APP_RO}, ${MIGRATOR}`);
    await sequelize.query(`CREATE SCHEMA IF NOT EXISTS ${READ_SCHEMA}`);

    // --- Ownership: el owner debe PODER crear y POSEER los objetos ----------------------------
    // Sin esto, `atlas_migrator` se queda sin DDL: no basta con ser miembro de `atlas_owner` si los
    // objetos los creó otro rol (PostgreSQL exige ser dueño —o miembro del rol dueño— para ALTER),
    // y `REVOKE CREATE ... FROM PUBLIC` le quita el permiso de crear en el schema. Verificado: sin
    // estos pasos, `CREATE TABLE` falla con "permiso denegado al esquema public" y `ALTER TABLE` con
    // "debe ser dueño de la tabla".
    await sequelize.query(`GRANT USAGE, CREATE ON SCHEMA "${core}" TO ${OWNER}`);
    await sequelize.query(`GRANT USAGE, CREATE ON SCHEMA ${READ_SCHEMA} TO ${OWNER}`);

    // Adopta la propiedad de los objetos existentes (creados históricamente por el admin) para que
    // el migrator pueda alterarlos. Es idempotente y no toca datos, solo el dueño.
    await sequelize.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('${core}', '${READ_SCHEMA}') LOOP
          EXECUTE format('ALTER TABLE %I.%I OWNER TO ${OWNER}', r.schemaname, r.tablename);
        END LOOP;
        FOR r IN SELECT schemaname, viewname FROM pg_views WHERE schemaname IN ('${core}', '${READ_SCHEMA}') LOOP
          EXECUTE format('ALTER VIEW %I.%I OWNER TO ${OWNER}', r.schemaname, r.viewname);
        END LOOP;
        FOR r IN SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname IN ('${core}', '${READ_SCHEMA}') LOOP
          EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO ${OWNER}', r.schemaname, r.sequencename);
        END LOOP;
      END$$;
    `);

    // El migrator asume el owner en cada sesión contra esta base: así todo lo que cree una migración
    // queda propiedad de `atlas_owner` (y las default privileges de abajo aplican de verdad), sin
    // depender de que cada migración recuerde hacer `SET ROLE`.
    await sequelize.query(`ALTER ROLE ${MIGRATOR} IN DATABASE "${identity.db}" SET role TO ${OWNER}`);

    await sequelize.query(`GRANT USAGE ON SCHEMA "${core}" TO ${APP_RW}`);
    await sequelize.query(`REVOKE CREATE ON SCHEMA "${core}" FROM ${APP_RW}`);
    await sequelize.query(`REVOKE CREATE ON SCHEMA "${core}" FROM PUBLIC`);
    await sequelize.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${core}" TO ${APP_RW}`);
    await sequelize.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${core}" TO ${APP_RW}`);

    // Tablas FUTURAS: las default privileges se cuelgan del rol que CREA el objeto. Se registran
    // para las tres identidades que pueden aplicar DDL (el admin actual, el owner y el migrator)
    // para que el runtime no se quede sin permisos tras la próxima migración, corra quien corra.
    for (const ddlRole of [identity.usr, OWNER, MIGRATOR]) {
      await sequelize.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${ddlRole} IN SCHEMA "${core}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_RW}`,
      );
      await sequelize.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${ddlRole} IN SCHEMA "${core}" GRANT USAGE, SELECT ON SEQUENCES TO ${APP_RW}`,
      );
      await sequelize.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${ddlRole} IN SCHEMA ${READ_SCHEMA} GRANT SELECT ON TABLES TO ${APP_RO}, ${APP_RW}`,
      );
    }

    // read_api: el rol RO solo ve vistas curadas, nunca tablas base del core.
    await sequelize.query(`GRANT USAGE ON SCHEMA ${READ_SCHEMA} TO ${APP_RO}, ${APP_RW}`);
    await sequelize.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${READ_SCHEMA} TO ${APP_RO}, ${APP_RW}`);
    await sequelize.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA ${READ_SCHEMA} FROM ${APP_RO}`);

    console.log('\n✅ Roles y grants aplicados.');
    console.log(`   Runtime      -> DB_USER=${APP_RW}`);
    console.log(`   Migraciones  -> DB_MIGRATION_USER=${MIGRATOR} (o tu admin actual)`);
    console.log(`   Solo lectura -> DB_READ_USER=${APP_RO}`);
    console.log('   Verifica con: yarn check:db-privileges');
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
