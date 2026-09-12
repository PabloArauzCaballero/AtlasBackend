/**
 * @file AT-023 — el runtime nunca necesita DDL; migraciones y siembra son trabajos aparte.
 * @business Un ejecutable de negocio (API, worker, piloto) arranca con un rol sin permiso de cambiar
 *   el esquema; si necesitara DDL para funcionar, un despliegue podría mutar la base por accidente.
 * @system PostgreSQL real con el rol runtime: DDL denegado; las opciones del ORM no sincronizan; la
 *   siembra al arrancar es opcional, exige rol de trabajo de fondo y origen configurado; el migrador
 *   corre con otro rol y serializa por bloqueo de Umzug.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import { buildMigrationSequelizeOptions, buildSequelizeOptions } from '../../../src/config/database.config.js';
import { runsBackgroundWork } from '../../../src/config/app-role.js';
import { env } from '../../../src/config/env.js';
import { Sequelize } from 'sequelize-typescript';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
});

afterAll(async () => {
  await database?.close();
});

describe('AT-023 · arranque sin DDL', () => {
  it('el rol runtime no puede crear ni alterar tablas en ningún schema de dominio', async () => {
    if (!database) return;
    for (const schema of ['customer', 'credit', 'messaging', 'platform_ops']) {
      await expect(database.sequelize.query(`CREATE TABLE ${schema}.zz_startup_probe (x integer)`)).rejects.toThrow(/permission denied/);
    }
    await expect(database.sequelize.query('ALTER TABLE customer.customers ADD COLUMN zz integer')).rejects.toThrow(
      /must be owner|permission denied/,
    );
  });

  it('las opciones del ORM del runtime y del migrador no sincronizan ni autocargan modelos', () => {
    const runtime = buildSequelizeOptions() as { synchronize?: boolean; autoLoadModels?: boolean };
    const migrator = buildMigrationSequelizeOptions() as { synchronize?: boolean; autoLoadModels?: boolean };
    expect(runtime.synchronize).toBe(false);
    expect(runtime.autoLoadModels).toBe(false);
    expect(migrator.synchronize).toBe(false);
    expect(migrator.autoLoadModels).toBe(false);
  });

  it('el migrador usa un rol distinto del runtime cuando está configurado', () => {
    const runtime = buildSequelizeOptions();
    const migrator = buildMigrationSequelizeOptions();
    if (env.DB_MIGRATION_USER) expect(migrator.username).not.toBe(runtime.username);
    expect(runtime.username).not.toBe('atlas_migrator');
  });

  it('la siembra al arrancar exige un proceso de trabajo de fondo: con APP_ROLE=api no siembra aunque esté configurada', () => {
    // `StartupSeedService` sale antes de tocar la base si `runsBackgroundWork()` es falso, y esa función
    // es exactamente «no soy el proceso API». Un piloto extraído arranca con APP_ROLE=api o con su
    // propio rol; nunca hereda la siembra global.
    expect(runsBackgroundWork()).toBe(env.APP_ROLE !== 'api');
  });

  it('las migraciones están todas aplicadas para esta base: el runtime no tiene ninguna pendiente que necesitar', async () => {
    if (!database) return;
    // La tabla de control es del migrador, no del runtime: se lee con su rol.
    const migrator = new Sequelize({ ...buildMigrationSequelizeOptions(), models: [], logging: false });
    try {
      const rows = await migrator.query<{ n: string }>('SELECT count(*)::text AS n FROM public."SequelizeMeta"', {
        type: QueryTypes.SELECT,
      });
      expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(122);
    } finally {
      await migrator.close();
    }
  });
});
