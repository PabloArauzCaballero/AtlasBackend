/**
 * @file El guardián de idempotencia de las restricciones mira la tabla de verdad, no `current_schema()`.
 * @business Una migración que se vuelve a aplicar —una reinstalación, un `down`→`up`, un reintento
 *   después de un fallo a medias— no puede morir diciendo que la restricción «ya existe»: evitar
 *   justamente eso es la única razón por la que el guardián existe.
 * @system Contra PostgreSQL real y con la identidad de migración, que trae el `search_path` de las
 *   migraciones: empieza en `public`, mientras que las tablas de negocio viven en schemas de dominio.
 *   Esa diferencia es la que rompía el guardián anterior (`information_schema.table_constraints`
 *   acotado a `current_schema()`), que respondía SIEMPRE «no existe».
 *
 *   Las tablas de usar y tirar se crean DENTRO DE UNA TRANSACCIÓN QUE SIEMPRE SE DESHACE, sobre un
 *   pool de UNA sola conexión. Las dos cosas van juntas y son deliberadas: con `max: 1` todas las
 *   sentencias —incluidas las que emite `queryInterface`— caen en la misma conexión y por tanto
 *   dentro de la transacción, y como el DDL de PostgreSQL es transaccional, al deshacerla no queda
 *   NADA. Importa porque una tabla huérfana en `platform_ops` no es basura inocente: haría fallar
 *   `test/integration/architecture/database-inventory.spec.ts` en todas las corridas siguientes. Si
 *   el proceso muere de golpe y no llega el `ROLLBACK`, el servidor lo hace igual al cerrarse la
 *   conexión, así que no hay forma de dejar residuo.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes, type QueryInterface } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { addChecks, addForeignKeys } from '../../../src/database/migration-support/atlas-schema-builder.util.js';
import { buildMigrationSequelizeOptions } from '../../../src/config/database.config.js';
import { integrationSkipRequested, runToken } from '../support/database.js';
import { requireIsolatedDatabase } from '../../support/isolated-database.guard.js';

const token = runToken();
const padre = `it_guard_padre_${token}`;
const hija = `it_guard_hija_${token}`;
const checkName = `ck_${hija}_tipo`;
const fkName = `fk_${hija}_padre_id`;

let migrador: Sequelize | null = null;
let queryInterface: QueryInterface | null = null;
let skipped = false;

beforeAll(async () => {
  requireIsolatedDatabase();
  const { retryAttempts, retryDelay, ...opciones } = buildMigrationSequelizeOptions();
  void retryAttempts;
  void retryDelay;
  // Pool de UNA conexión: es lo que garantiza que el `BEGIN` de abajo alcance a todas las sentencias.
  migrador = new Sequelize({ ...opciones, models: [], logging: false, pool: { max: 1, min: 1, idle: 10_000, acquire: 30_000 } });
  try {
    await migrador.authenticate();
  } catch (error) {
    await migrador.close().catch(() => undefined);
    migrador = null;
    if (integrationSkipRequested()) {
      skipped = true;
      return;
    }
    throw error;
  }
  queryInterface = migrador.getQueryInterface();
  await migrador.query('BEGIN');
  await migrador.query(`CREATE TABLE platform_ops.${padre} (id integer PRIMARY KEY)`);
  await migrador.query(`CREATE TABLE platform_ops.${hija} (id integer PRIMARY KEY, tipo text NOT NULL, padre_id integer)`);
});

afterAll(async () => {
  // Deshace la transacción entera: las dos tablas y sus restricciones desaparecen sin `DROP`.
  await migrador?.query('ROLLBACK').catch(() => undefined);
  await migrador?.close().catch(() => undefined);
});

/** Cuántas restricciones con ese nombre hay SOBRE LA TABLA hija (no en toda la base). */
async function cuantas(nombre: string): Promise<number> {
  const filas = (await migrador!.query(
    `SELECT count(*)::int AS total FROM pg_constraint WHERE conname = $nombre AND conrelid = to_regclass($tabla)`,
    { type: QueryTypes.SELECT, bind: { nombre, tabla: `platform_ops.${hija}` } },
  )) as Array<{ total: number }>;
  return filas[0]?.total ?? 0;
}

describe('guardián de idempotencia de restricciones', () => {
  it('la tabla del caso NO está en current_schema(): es la condición que rompía el guardián', async () => {
    if (skipped) return;
    const filas = (await migrador!.query('SELECT current_schema() AS actual', { type: QueryTypes.SELECT })) as Array<{ actual: string }>;
    expect(filas[0].actual).toBe('public');
    const ubicacion = (await migrador!.query(`SELECT to_regclass('platform_ops.${hija}') IS NOT NULL AS existe`, {
      type: QueryTypes.SELECT,
    })) as Array<{ existe: boolean }>;
    expect(ubicacion[0].existe).toBe(true);
  });

  it('addChecks aplicado dos veces deja UNA restricción y no lanza la segunda vez', async () => {
    if (skipped) return;
    const spec = [{ table: hija, name: checkName, expression: "tipo IN ('a', 'b')" }];
    expect(await cuantas(checkName)).toBe(0);
    await addChecks(queryInterface!, spec);
    expect(await cuantas(checkName)).toBe(1);
    // Antes de la corrección esta segunda llamada moría con «constraint already exists».
    await expect(addChecks(queryInterface!, spec)).resolves.toBeUndefined();
    expect(await cuantas(checkName)).toBe(1);
  });

  it('addForeignKeys aplicado dos veces deja UNA clave foránea y no lanza la segunda vez', async () => {
    if (skipped) return;
    const spec = [{ table: hija, column: 'padre_id', targetTable: padre, targetColumn: 'id', allowNull: true }];
    expect(await cuantas(fkName)).toBe(0);
    await addForeignKeys(queryInterface!, spec);
    expect(await cuantas(fkName)).toBe(1);
    await expect(addForeignKeys(queryInterface!, spec)).resolves.toBeUndefined();
    expect(await cuantas(fkName)).toBe(1);
  });
});
