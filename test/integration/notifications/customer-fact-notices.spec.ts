/**
 * @file Los avisos de «ya está hecho» al cliente, del outbox al mensaje entregado en su bandeja.
 * @business Pablo (2026-10-16): «tu capacidad fue actualizada». La prueba de que un evento avisó es el mensaje
 *   con su `outbox_event_id` Y una entrega `delivered` (memoria `atlas-eventos-de-dominio-sin-aviso`).
 * @system PostgreSQL real: `CustomerNoticePublisher` escribe el aviso de `customer-notices.ts`; el orquestador real lo
 *   convierte en mensaje con la regla y la plantilla sembrada por `20261016120000`. Las preferencias se
 *   sustituyen por «sólo bandeja» para no ejercer el adaptador de push (necesita FCM/APNs).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import {
  NotificationDeliveryModel,
  NotificationMessageModel,
  NotificationTemplateModel,
  OutboxEventModel,
} from '../../../src/database/models/index.js';
import {
  bankStatementNotice,
  creditLineNotice,
  CustomerNoticePublisher,
} from '../../../src/modules/credit/application/customer-notices.js';
import { InAppNotificationAdapter } from '../../../src/modules/notifications/adapters/in-app-notification.adapter.js';
import { NotificationChannelRegistry } from '../../../src/modules/notifications/notification-channel-registry.service.js';
import { NotificationDeliveryPayloadBuilder } from '../../../src/modules/notifications/notification-delivery-payload.builder.js';
import { NotificationDispatchService } from '../../../src/modules/notifications/notification-dispatch.service.js';
import { NotificationEventHandlerService } from '../../../src/modules/notifications/notification-event-handler.service.js';
import { NotificationRulesService } from '../../../src/modules/notifications/notification-rules.service.js';
import { NotificationTemplateRendererService } from '../../../src/modules/notifications/notification-template-renderer.service.js';
import { NotificationTemplatesRepository } from '../../../src/modules/notifications/notification-templates.repository.js';
import { NotificationDeliveriesRepository } from '../../../src/modules/notifications/notification-deliveries.repository.js';
import { NotificationMessagesRepository } from '../../../src/modules/notifications/notification-messages.repository.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const token = runToken();
let tenant = '';
let notices: CustomerNoticePublisher;
let orchestrator: NotificationEventHandlerService;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  const { sequelize } = database;
  const rows = await sequelize.query<{ id: string }>(`INSERT INTO iam.tenants (_created_at) VALUES (now()) RETURNING _id::text AS id`, {
    type: QueryTypes.SELECT,
  });
  tenant = rows[0]!.id;
  notices = new CustomerNoticePublisher(sequelize);

  const unused = {} as never;
  const messages = new NotificationMessagesRepository(NotificationMessageModel);
  const dispatch = new NotificationDispatchService(
    messages,
    new NotificationDeliveriesRepository(NotificationDeliveryModel),
    new NotificationChannelRegistry(new InAppNotificationAdapter(), unused, unused, unused, unused),
    // La bandeja no tiene destino externo: sin dispositivos ni contactos que leer.
    new NotificationDeliveryPayloadBuilder({ getActivePushDevices: async () => [], getCustomerContactTargets: async () => [] } as never),
  );
  // Sólo la bandeja: el push necesita FCM/APNs y su entrega ya la cubren las pruebas del adaptador.
  const soloBandeja = { isChannelEnabled: async ({ channel }: { channel: string }) => channel === 'in_app' };
  orchestrator = new NotificationEventHandlerService(
    new NotificationRulesService(),
    soloBandeja as never,
    new NotificationTemplatesRepository(NotificationTemplateModel),
    new NotificationTemplateRendererService(),
    messages,
    dispatch,
  );
});

afterAll(async () => {
  if (database && tenant) {
    const { sequelize } = database;
    const bind = { tenant };
    await sequelize.query(
      `DELETE FROM messaging.notification_deliveries WHERE notification_message_id IN (SELECT _id FROM messaging.notification_messages WHERE _tenant_id = $tenant)`,
      { bind },
    );
    await sequelize.query(`DELETE FROM messaging.notification_messages WHERE _tenant_id = $tenant`, { bind });
    await sequelize.query(`DELETE FROM platform_ops.outbox_events WHERE _tenant_id = $tenant`, { bind });
  }
  await database?.close();
});

async function avisoDe(eventCode: string, idempotencyKey: string) {
  const row = await OutboxEventModel.findOne({ where: { tenantId: tenant, eventCode, idempotencyKey } });
  expect(row).not.toBeNull();
  await orchestrator.handleEvent(row!);
  const mensajes = await NotificationMessageModel.findAll({ where: { tenantId: tenant, outboxEventId: String(row!.id) } });
  const entregas = await NotificationDeliveryModel.findAll({ where: { notificationMessageId: mensajes.map((m) => m.id) } });
  return { row: row!, mensajes, entregas };
}

describe('avisos de «ya está hecho» al cliente (Postgres real)', () => {
  it('«Tu capacidad fue actualizada»: el extracto aplicado deja mensaje en la bandeja, entregado y con su destino', async () => {
    if (!database) return;
    const customerId = `c-${token}`;
    await notices.publish(bankStatementNotice({ kind: 'applied', tenantId: tenant, customerId, reviewId: `r-${token}`, newLimit: 1275 }));

    const { mensajes, entregas } = await avisoDe('bank_statement.applied', `bank-statement-r-${token}-applied`);

    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toMatchObject({
      channel: 'in_app',
      recipientType: 'customer',
      recipientId: customerId,
      title: 'Tu capacidad fue actualizada',
      body: 'Leímos tu extracto y recalculamos tu línea: ahora es de Bs 1.275.',
      category: 'credit',
    });
    expect((mensajes[0]!.payloadJson as Record<string, unknown>).deepLink).toBe('/');
    expect(entregas.map((e) => e.status)).toEqual(['delivered']);
  });

  it('una línea que sube fuera del extracto avisa con la cifra; la misma cifra no escribe nada', async () => {
    if (!database) return;
    const customerId = `c2-${token}`;
    const subida = creditLineNotice({
      tenantId: tenant,
      customerId,
      creditLineId: `l1-${token}`,
      trigger: 'manual',
      previousLimit: 900,
      newLimit: 1500,
    });
    await notices.publish(subida);
    const { mensajes, entregas } = await avisoDe('credit_line.increased', `credit-line-l1-${token}`);
    expect(mensajes[0]).toMatchObject({ title: 'Tu capacidad fue actualizada', body: 'Tu línea de crédito subió a Bs 1.500.' });
    expect(entregas.map((e) => e.status)).toEqual(['delivered']);

    const igual = creditLineNotice({
      tenantId: tenant,
      customerId,
      creditLineId: `l2-${token}`,
      trigger: 'manual',
      previousLimit: 1500,
      newLimit: 1500,
    });
    await notices.publish(igual);
    expect(await OutboxEventModel.count({ where: { tenantId: tenant, idempotencyKey: `credit-line-l2-${token}` } })).toBe(0);
  });

  it('el mismo desenlace dos veces es UN evento (idempotencia por revisión y desenlace)', async () => {
    if (!database) return;
    const aviso = bankStatementNotice({
      kind: 'rejected',
      tenantId: tenant,
      customerId: `c3-${token}`,
      reviewId: `r3-${token}`,
      message: 'Faltan meses.',
    });
    await notices.publish(aviso);
    await notices.publish(aviso);
    expect(await OutboxEventModel.count({ where: { tenantId: tenant, idempotencyKey: `bank-statement-r3-${token}-rejected` } })).toBe(1);
    const { mensajes } = await avisoDe('bank_statement.rejected', `bank-statement-r3-${token}-rejected`);
    expect(mensajes[0]).toMatchObject({ title: 'No pudimos usar tu extracto', body: 'Faltan meses.' });
  });
});
