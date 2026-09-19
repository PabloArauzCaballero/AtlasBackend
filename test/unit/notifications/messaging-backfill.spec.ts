/**
 * @file AT-058 — las guardas de la copia de Mensajería: sólo sus tablas, sólo identificadores válidos.
 * @business La herramienta de copia de la transición no puede llevarse tablas de Crédito o Clientes ni
 *   aceptar un nombre de schema con inyección; y la lista de tablas de Mensajería es la del inventario.
 * @system Partes puras: sin base. El camino completo (copia, reanudación, reconciliación) se prueba contra
 *   PostgreSQL en `test/integration/messaging/pilot-backfill.spec.ts`.
 */
import { describe, expect, it } from '@jest/globals';
import {
  assertMessagingTable,
  copyTable,
  MESSAGING_TABLES,
  prepareTarget,
  reconcileTable,
} from '../../../src/modules/notifications/infrastructure/pilot/messaging-backfill.js';
import type { Sequelize } from 'sequelize-typescript';

const unusable = { query: async () => [] } as unknown as Sequelize;

describe('guardas de la copia de Mensajería', () => {
  it('la lista de tablas es exactamente la de Mensajería (seis), sin colarse ninguna ajena', () => {
    expect([...MESSAGING_TABLES].sort()).toEqual([
      'device_tokens',
      'notification_deliveries',
      'notification_messages',
      'notification_policies',
      'notification_templates',
      'user_notification_preferences',
    ]);
  });

  it('una tabla que no es de Mensajería se rechaza por nombre', () => {
    expect(assertMessagingTable('notification_messages')).toBe('notification_messages');
    for (const foreign of ['credit_applications', 'customers', 'internal_users', 'outbox_events']) {
      expect(() => assertMessagingTable(foreign)).toThrow(/BACKFILL_TABLE_NOT_MESSAGING/);
    }
  });

  it('la copia y la reconciliación también rechazan la tabla ajena antes de tocar la base', async () => {
    const lookup = { sequelize: unusable, targetSchema: 'messaging_pilot', watermark: new Date() };
    await expect(copyTable({ ...lookup, table: 'customers' as never, batchSize: 10 })).rejects.toThrow(/BACKFILL_TABLE_NOT_MESSAGING/);
    await expect(reconcileTable({ ...lookup, table: 'credit_applications' as never })).rejects.toThrow(/BACKFILL_TABLE_NOT_MESSAGING/);
  });

  it('un schema destino con caracteres raros se rechaza (nada de inyección por el nombre)', async () => {
    for (const target of ['messaging pilot', 'pilot;DROP TABLE x', 'Pilot', '1pilot', 'pilot"', '']) {
      await expect(prepareTarget(unusable, target)).rejects.toThrow(/BACKFILL_IDENTIFIER_INVALID/);
    }
  });

  it('un schema destino válido llega hasta la base (falla por la base de mentira, no por el nombre)', async () => {
    await expect(prepareTarget(unusable, 'messaging_pilot_ab12')).resolves.toBeUndefined();
  });
});
