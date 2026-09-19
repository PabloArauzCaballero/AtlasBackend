/**
 * @file AT-058 — copia reanudable de Mensajería, catch-up hasta la marca de agua y lectura sombra sin efectos.
 * @business Una copia que se corta a medias se reanuda sin duplicar; una notificación creada durante la copia
 *   aparece tras el catch-up; la reconciliación no deja diferencias sin explicar; la lectura sombra no
 *   toca el origen ni llama a ningún proveedor.
 * @system PostgreSQL real con un schema destino desechable por corrida (`messaging_pilot_<token>`), creado y
 *   borrado con la identidad de migración; la copia usa `copyTable` (lotes + punto de control).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { createMigrationSequelizeInstance } from '../../../src/database/sequelize.js';
import {
  copyTable,
  databaseNow,
  prepareTarget,
  reconcileTable,
  shadowReadSummary,
} from '../../../src/modules/notifications/infrastructure/pilot/messaging-backfill.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let ddl: Sequelize | null = null;
const token = runToken();
const target = `messaging_pilot_${token}`;
const codePrefix = `it-bf-${token}`;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  ddl = createMigrationSequelizeInstance();
  await prepareTarget(ddl, target);
});
afterAll(async () => {
  if (ddl) {
    await ddl.query(`DROP SCHEMA IF EXISTS ${target} CASCADE`);
    await ddl.query(`DELETE FROM messaging.notification_templates WHERE code LIKE $prefix`, { bind: { prefix: `${codePrefix}%` } });
    await ddl.close();
  }
  await database?.close();
});

async function seedTemplate(index: number): Promise<void> {
  await ddl!.query(
    `INSERT INTO messaging.notification_templates (_tenant_id, code, channel, locale, body_template, is_active, version, _created_at)
     VALUES (NULL, $code, 'in_app', 'es', 'cuerpo', true, 1, now())`,
    { bind: { code: `${codePrefix}-${index}` } },
  );
}

async function sourceHash(): Promise<string> {
  const rows = await ddl!.query<{ h: string }>(
    `SELECT md5(coalesce(string_agg(md5(t::text), ',' ORDER BY t._id), '')) AS h FROM messaging.notification_templates t`,
    { type: QueryTypes.SELECT },
  );
  return rows[0].h;
}

describe('AT-058 · copia y comparación sin duplicar efectos', () => {
  it('copia interrumpida → reanudada sin duplicar; nueva fila durante la copia → aparece tras el catch-up; reconciliación limpia', async () => {
    if (!ddl) return;
    for (let index = 0; index < 5; index += 1) await seedTemplate(index);
    const watermark = await databaseNow(ddl);

    const interrupted = await copyTable({
      sequelize: ddl,
      table: 'notification_templates',
      targetSchema: target,
      watermark,
      batchSize: 2,
      maxBatches: 1,
    });
    expect(interrupted.done).toBe(false);
    expect(interrupted.checkpoint.processed).toBe(2);

    // «Nueva notificación durante el backfill»: llega después de la marca de agua de esta pasada.
    await seedTemplate(5);

    const resumed = await copyTable({ sequelize: ddl, table: 'notification_templates', targetSchema: target, watermark, batchSize: 2 });
    expect(resumed.done).toBe(true);
    const first = await reconcileTable({ sequelize: ddl, table: 'notification_templates', targetSchema: target, watermark });
    expect(first.missingInTarget).toEqual([]);
    expect(first.extraInTarget).toEqual([]);
    expect(first.hashMatch).toBe(true);
    expect(first.sourceCount).toBe(first.targetCount);

    // Catch-up con marca de agua nueva: la fila creada durante la copia se incorpora; nada se duplica.
    const later = await databaseNow(ddl);
    const catchUp = await copyTable({
      sequelize: ddl,
      table: 'notification_templates',
      targetSchema: target,
      watermark: later,
      batchSize: 2,
    });
    expect(catchUp.done).toBe(true);
    const second = await reconcileTable({ sequelize: ddl, table: 'notification_templates', targetSchema: target, watermark: later });
    expect(second.targetCount).toBe(first.targetCount + 1);
    expect(second.hashMatch).toBe(true);
    const copiedCodes = await ddl.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${target}.notification_templates WHERE code LIKE $prefix`,
      { type: QueryTypes.SELECT, bind: { prefix: `${codePrefix}%` } },
    );
    expect(Number(copiedCodes[0].n)).toBe(6);
  });

  it('lectura sombra: sólo SELECT sobre el destino; el origen queda idéntico y no hay adaptador que llamar', async () => {
    if (!ddl) return;
    const before = await sourceHash();
    const summary = await shadowReadSummary({ sequelize: ddl, targetSchema: target });
    expect(summary).toEqual({ messagesByStatus: expect.any(Object), deliveriesByStatus: expect.any(Object) });
    expect(await sourceHash()).toBe(before);
  });

  it('una tabla que no es de Mensajería se rechaza: el copiador no puede llevarse Crédito o Clientes', async () => {
    if (!ddl) return;
    await expect(
      copyTable({ sequelize: ddl, table: 'credit_applications' as never, targetSchema: target, watermark: new Date(), batchSize: 10 }),
    ).rejects.toThrow(/BACKFILL_TABLE_NOT_MESSAGING/);
  });
});
