/**
 * @file El paso de privilegios del despliegue deja al runtime con acceso a lo que una migración acaba de crear.
 * @business Una tabla nueva sin permiso para el rol de la API es un 500 «permission denied» en la
 *   primera petición que la toque. El despliegue se ve verde y el fallo aparece cuando alguien abre
 *   la pantalla, que es el peor momento para descubrirlo.
 * @system Contra PostgreSQL real. Se crea una tabla en un schema de dominio DESPUÉS de conceder,
 *   como hace una migración, se comprueba que el rol de runtime no la alcanza, se ejecuta
 *   `applyRuntimeGrants` y se comprueba que sí. Todo dentro de una transacción que se deshace, de
 *   modo que no queda ni la tabla ni un privilegio de más.
 *
 *   Si la base no tiene la jerarquía de roles de mínimo privilegio (un desarrollo con superusuario),
 *   la función es un no-op declarado y la prueba lo fija como tal en vez de saltarse en silencio.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { applyRuntimeGrants } from '../../../src/database/apply-grants.js';
import { buildMigrationSequelizeOptions } from '../../../src/config/database.config.js';
import { integrationSkipRequested, runToken } from '../support/database.js';
import { requireIsolatedDatabase } from '../../support/isolated-database.guard.js';

const tabla = `it_grants_${runToken()}`;
let db: Sequelize | null = null;
let skipped = false;
let hayJerarquia = false;

beforeAll(async () => {
  requireIsolatedDatabase();
  const { retryAttempts, retryDelay, ...opciones } = buildMigrationSequelizeOptions();
  void retryAttempts;
  void retryDelay;
  // Pool de una conexión: la transacción de abajo tiene que alcanzar a TODAS las sentencias.
  db = new Sequelize({ ...opciones, models: [], logging: false, pool: { max: 1, min: 1, idle: 10_000, acquire: 30_000 } });
  try {
    await db.authenticate();
  } catch (error) {
    await db.close().catch(() => undefined);
    db = null;
    if (integrationSkipRequested()) {
      skipped = true;
      return;
    }
    throw error;
  }
  const roles = (await db.query("SELECT 1 AS ok FROM pg_roles WHERE rolname = 'atlas_app_rw'", {
    type: QueryTypes.SELECT,
  })) as Array<{ ok: number }>;
  hayJerarquia = roles.length > 0;
  await db.query('BEGIN');
});

afterAll(async () => {
  await db?.query('ROLLBACK').catch(() => undefined);
  await db?.close().catch(() => undefined);
});

async function puedeLeer(): Promise<boolean> {
  const filas = (await db!.query(`SELECT COALESCE(has_table_privilege('atlas_app_rw', to_regclass($tabla), 'SELECT'), false) AS puede`, {
    type: QueryTypes.SELECT,
    bind: { tabla: `platform_ops.${tabla}` },
  })) as Array<{ puede: boolean }>;
  return filas[0]?.puede === true;
}

describe('privilegios de runtime tras migrar', () => {
  it('una tabla creada después de conceder NO es legible hasta que se reaplican los privilegios', async () => {
    if (skipped || !hayJerarquia) return;
    await db!.query(`CREATE TABLE platform_ops.${tabla} (id integer PRIMARY KEY)`);
    // Ésta es la situación real de un aprovisionamiento nuevo: el guion del DBA corrió antes que las
    // migraciones, así que esta tabla nació sin permisos para el rol de la API.
    await db!.query(`REVOKE ALL ON TABLE platform_ops.${tabla} FROM atlas_app_rw`);
    expect(await puedeLeer()).toBe(false);

    await applyRuntimeGrants(db!);
    expect(await puedeLeer()).toBe(true);
  });

  it('es idempotente: volver a ejecutarlo no cambia nada ni lanza', async () => {
    if (skipped || !hayJerarquia) return;
    await expect(applyRuntimeGrants(db!)).resolves.toEqual(expect.arrayContaining(['platform_ops', 'read_api']));
    expect(await puedeLeer()).toBe(true);
  });

  it('el rol de sólo lectura NO entra a los schemas de dominio', async () => {
    if (skipped || !hayJerarquia) return;
    const roles = (await db!.query("SELECT 1 AS ok FROM pg_roles WHERE rolname = 'atlas_app_ro'", {
      type: QueryTypes.SELECT,
    })) as Array<{ ok: number }>;
    if (roles.length === 0) return;
    const filas = (await db!.query(`SELECT COALESCE(has_table_privilege('atlas_app_ro', to_regclass($tabla), 'SELECT'), false) AS puede`, {
      type: QueryTypes.SELECT,
      bind: { tabla: `platform_ops.${tabla}` },
    })) as Array<{ puede: boolean }>;
    expect(filas[0].puede).toBe(false);
  });

  it('sin la jerarquía de roles es un no-op declarado, no un fallo de despliegue', async () => {
    if (skipped || hayJerarquia) return;
    await expect(applyRuntimeGrants(db!)).resolves.toEqual([]);
  });
});
