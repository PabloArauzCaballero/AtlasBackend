/**
 * @file Reaplica los privilegios de runtime DESPUÉS de migrar, como parte del despliegue.
 * @business El rol con el que sirve la API no puede leer una tabla que una migración acaba de
 *   crear si nadie le concede el permiso: la pantalla que la usa responde 500 «permission denied»
 *   en la primera petición, y el despliegue se ve verde hasta que alguien la abre.
 * @system Mismo contenido que `ops/postgres/grants.sql` —que sigue siendo el guion del DBA para el
 *   aprovisionamiento inicial— pero ejecutable con la conexión de migración y derivando la lista de
 *   schemas de `ATLAS_SCHEMAS`, que es la fuente de verdad. El gate `check:db-privileges` compara
 *   contra esa misma lista, así que las tres cosas no pueden divergir.
 *
 * Por qué hace falta además del guion: `ALTER DEFAULT PRIVILEGES` sólo alcanza a los schemas que
 * EXISTÍAN cuando se ejecutó. Un aprovisionamiento nuevo corre el guion sobre una base vacía —donde
 * no hay ningún schema todavía—, las migraciones crean los quince, y las tablas nacen sin un solo
 * permiso para el runtime. Medido en el ensayo de producción del 2026-09-13: 30 tablas de 202
 * quedaron ilegibles para `atlas_app_rw`, entre ellas `credit.credit_lines` y `iam.merchant_users`.
 *
 * Es idempotente y no toca datos: sólo GRANT/REVOKE y privilegios por omisión.
 */
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { ATLAS_SCHEMAS } from './atlas-schemas.js';
import { createMigrationSequelizeInstance } from './sequelize.js';

const READ_SCHEMA = 'read_api';
const APP_RW = 'atlas_app_rw';
const APP_RO = 'atlas_app_ro';
/** Identidad EFECTIVA de las migraciones: `atlas_migrator` entra con `SET role TO atlas_owner`. */
const OWNER = 'atlas_owner';

/** ¿Existe el rol? En una base de desarrollo sin la jerarquía, este paso no tiene nada que hacer. */
async function roleExists(sequelize: Sequelize, role: string): Promise<boolean> {
  const rows = (await sequelize.query('SELECT 1 AS ok FROM pg_roles WHERE rolname = :role', {
    type: QueryTypes.SELECT,
    replacements: { role },
  })) as Array<{ ok: number }>;
  return rows.length > 0;
}

/**
 * Cita un nombre de schema para interpolarlo en DDL.
 *
 * Los nombres salen de `ATLAS_SCHEMAS` —una constante del repositorio, no entrada de nadie—, pero se
 * valida igual: es DDL concatenado, y la regla de «nunca concatenes lo que no has comprobado» no
 * admite excepciones por procedencia. Un nombre que no sea un identificador simple es un error de
 * programación y debe romper aquí, no en el servidor.
 */
function quoteSchema(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`Nombre de schema no admitido para DDL: "${schema}".`);
  }
  return `"${schema}"`;
}

async function schemaExists(sequelize: Sequelize, schema: string): Promise<boolean> {
  const rows = (await sequelize.query('SELECT 1 AS ok FROM pg_namespace WHERE nspname = :schema', {
    type: QueryTypes.SELECT,
    replacements: { schema },
  })) as Array<{ ok: number }>;
  return rows.length > 0;
}

/**
 * Concede al runtime lo que necesita en cada schema de dominio y nada más.
 *
 * Devuelve los schemas tocados. No lanza si falta un rol: en desarrollo se trabaja con un
 * superusuario y este paso debe ser un no-op ruidoso, no un fallo de despliegue.
 */
export async function applyRuntimeGrants(sequelize: Sequelize): Promise<string[]> {
  if (!(await roleExists(sequelize, APP_RW))) return [];

  const touched: string[] = [];
  for (const schema of Object.values(ATLAS_SCHEMAS)) {
    if (!(await schemaExists(sequelize, schema))) continue;
    const id = quoteSchema(schema);
    // Sentencias sueltas y no un bloque `DO`: dentro de `$$ ... $$` el servidor ve el cuerpo como
    // una cadena, así que ni los parámetros ligados ni los reemplazos de Sequelize entran ahí —el
    // primer intento murió con «syntax error at or near ":"»—. El identificador va validado arriba.
    await sequelize.query(`GRANT USAGE ON SCHEMA ${id} TO ${APP_RW}`);
    await sequelize.query(`REVOKE CREATE ON SCHEMA ${id} FROM ${APP_RW}`);
    await sequelize.query(`REVOKE CREATE ON SCHEMA ${id} FROM PUBLIC`);
    await sequelize.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${id} TO ${APP_RW}`);
    await sequelize.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${id} TO ${APP_RW}`);
    await sequelize.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA ${id} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_RW}`,
    );
    await sequelize.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA ${id} GRANT USAGE, SELECT ON SEQUENCES TO ${APP_RW}`);

    // El rol de sólo lectura NO entra a los schemas de dominio: lee `read_api`, que es la superficie
    // curada. Revocar es tan importante como conceder — un GRANT heredado lo dejaría dentro.
    if (await roleExists(sequelize, APP_RO)) {
      await sequelize.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${id} FROM ${APP_RO}`);
      await sequelize.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${id} FROM ${APP_RO}`);
    }
    touched.push(schema);
  }

  if (await schemaExists(sequelize, READ_SCHEMA)) {
    const readers = (await roleExists(sequelize, APP_RO)) ? `${APP_RO}, ${APP_RW}` : APP_RW;
    await sequelize.query(`GRANT USAGE ON SCHEMA ${READ_SCHEMA} TO ${readers}`);
    await sequelize.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${READ_SCHEMA} TO ${readers}`);
    await sequelize.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA ${READ_SCHEMA} GRANT SELECT ON TABLES TO ${readers}`);
    if (await roleExists(sequelize, APP_RO)) {
      await sequelize.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA ${READ_SCHEMA} FROM ${APP_RO}`);
    }
    touched.push(READ_SCHEMA);
  }

  // El runtime LEE el libro de migraciones al arrancar para avisar de pendientes; no escribe en él.
  await sequelize.query(`GRANT USAGE ON SCHEMA public TO ${APP_RW}`);
  await sequelize.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${APP_RW}`);

  return touched;
}

async function main(): Promise<void> {
  const sequelize = createMigrationSequelizeInstance();
  try {
    const touched = await applyRuntimeGrants(sequelize);
    if (touched.length === 0) {
      console.log('[grants] no existe el rol atlas_app_rw: esta base no usa la jerarquía de privilegios mínimos. Nada que aplicar.');
      return;
    }
    console.log(`[grants] privilegios de runtime reaplicados en ${touched.length} schemas: ${touched.join(', ')}.`);
  } finally {
    await sequelize.close();
  }
}

// Sólo actúa como CLI cuando se ejecuta directamente; importarlo desde una prueba no abre conexiones.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
