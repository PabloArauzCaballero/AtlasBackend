/**
 * @file Aviso interno de plazos de soporte: del barrido al mensaje de operaciones.
 * @business Un caso que está por incumplir su plazo (o ya lo incumplió) le llega a operaciones como mensaje
 *   de bandeja con texto de persona; antes `support.sla.warning` no lo publicaba nadie y
 *   `support.sla.breached` no tenía canales: 13 incumplimientos medidos, 0 avisos.
 * @system PostgreSQL real: `SupportSlaService` con sus repositorios, el outbox (`EventsRepository`) y el
 *   orquestador de notificaciones con la regla `operations`/`in_app` y la plantilla sembrada por la migración
 *   `20260929210000`. Sólo se sustituye lo que no se ejerce (adaptadores de otros canales, preferencias).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes } from 'sequelize';
import {
  NotificationDeliveryModel,
  NotificationMessageModel,
  NotificationTemplateModel,
  OutboxEventModel,
  SupportCaseEventModel,
  SupportCaseModel,
  SupportSlaClockModel,
  SupportSlaPolicyModel,
} from '../../../src/database/models/index.js';
import { EventsRepository } from '../../../src/modules/events/events.repository.js';
import { EventsService } from '../../../src/modules/events/events.service.js';
import { InAppNotificationAdapter } from '../../../src/modules/notifications/adapters/in-app-notification.adapter.js';
import { NotificationOrchestratorService } from '../../../src/modules/notifications/notification-orchestrator.service.js';
import { NotificationRulesService } from '../../../src/modules/notifications/notification-rules.service.js';
import { NotificationTemplateRendererService } from '../../../src/modules/notifications/notification-template-renderer.service.js';
import { NotificationTemplatesRepository } from '../../../src/modules/notifications/notification-templates.repository.js';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository.js';
import { SupportSlaService } from '../../../src/modules/support/application/support-sla.service.js';
import { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import { SupportCaseTimelineRepository } from '../../../src/modules/support/support-case-timeline.repository.js';
import { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
const token = runToken();
const ids = { tenant: '', policy: '', caseId: '', clock: '' };

let sla: SupportSlaService;
let orchestrator: NotificationOrchestratorService;

async function scalar(sql: string, bind: Record<string, unknown>): Promise<string> {
  const rows = await database!.sequelize.query<{ id: string }>(sql, { type: QueryTypes.SELECT, bind });
  return String(rows[0]!.id);
}

async function outboxRows(eventCode: string) {
  return OutboxEventModel.findAll({ where: { tenantId: ids.tenant, eventCode }, order: [['id', 'ASC']] });
}

async function messagesOf(outboxEventId: string) {
  return NotificationMessageModel.findAll({ where: { tenantId: ids.tenant, outboxEventId } });
}

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  const { sequelize } = database;

  ids.tenant = await scalar(`INSERT INTO iam.tenants (_created_at) VALUES (now()) RETURNING _id AS id`, {});
  ids.policy = await scalar(
    `INSERT INTO support.support_sla_policies (_tenant_id, policy_code, priority, calendar_kind, acknowledge_target_minutes,
       first_response_target_minutes, update_interval_minutes, resolution_target_minutes, warning_percents_json, _created_at)
     VALUES ($tenant, $code, 'P3', '24x7', 10, 30, 60, 120, '[50, 80]'::jsonb, now()) RETURNING _id AS id`,
    { tenant: ids.tenant, code: `it-sla-${token}` },
  );
  ids.caseId = await scalar(
    `INSERT INTO support.support_cases (_tenant_id, case_number, subject_context_type, opened_by_actor_type, opened_by_actor_id,
       case_type, title, sla_policy_version_id, _created_at)
     VALUES ($tenant, $number, 'INTERNAL', 'INTERNAL_USER', 'it', 'QUESTION', 'Caso de prueba del aviso de plazo', $policy, now())
     RETURNING _id AS id`,
    { tenant: ids.tenant, number: `IT-${token}`, policy: ids.policy },
  );
  // Un plazo de 120 min que empezó hace 100: va al 83 % y cruza el 50 y el 80, pero aún no vence.
  ids.clock = await scalar(
    `INSERT INTO support.support_sla_clocks (_tenant_id, case_id, metric_type, policy_version_id, started_at, target_at, state, _created_at)
     VALUES ($tenant, $caseId, 'RESOLUTION', $policy, now() - interval '100 minutes', now() + interval '20 minutes', 'RUNNING', now())
     RETURNING _id AS id`,
    { tenant: ids.tenant, caseId: ids.caseId, policy: ids.policy },
  );

  const events = new EventsService(new EventsRepository(OutboxEventModel, sequelize), {} as never);
  sla = new SupportSlaService(
    sequelize,
    new SupportCaseTimelineRepository({} as never, SupportSlaClockModel, {} as never, {} as never, {} as never, {} as never),
    new SupportCaseRepository(sequelize, SupportCaseModel, SupportCaseEventModel),
    new SupportCatalogRepository({} as never, {} as never, SupportSlaPolicyModel, {} as never),
    events,
  );

  // Se ejerce la regla y la plantilla REALES; los adaptadores de otros canales y las preferencias (sólo las
  // consultan los destinatarios cliente) no intervienen en un aviso a operaciones.
  const notifications = new NotificationsRepository(
    NotificationMessageModel,
    NotificationDeliveryModel,
    {} as never,
    {} as never,
    new NotificationTemplatesRepository(NotificationTemplateModel),
    {} as never,
  );
  const unused = {} as never;
  orchestrator = new NotificationOrchestratorService(
    new NotificationRulesService(),
    notifications,
    new NotificationTemplateRendererService(),
    new InAppNotificationAdapter(),
    unused,
    unused,
    unused,
    unused,
  );
});

/*
 * Se limpian el outbox y los mensajes. El caso, sus eventos, su reloj y el inquilino NO se borran: la
 * historia del caso es append-only por diseño (`SUPPORT_APPEND_ONLY_VIOLATION` ante un DELETE) y cuelga del
 * inquilino con FK. Quedan aislados por un inquilino propio de cada corrida, en una base desechable.
 */
afterAll(async () => {
  if (database && ids.tenant) {
    const { sequelize } = database;
    const bind = { tenant: ids.tenant };
    await sequelize.query(
      `DELETE FROM messaging.notification_deliveries WHERE notification_message_id IN (SELECT _id FROM messaging.notification_messages WHERE _tenant_id = $tenant)`,
      { bind },
    );
    await sequelize.query(`DELETE FROM messaging.notification_messages WHERE _tenant_id = $tenant`, { bind });
    await sequelize.query(`DELETE FROM platform_ops.outbox_events WHERE _tenant_id = $tenant`, { bind });
  }
  await database?.close();
});

describe('aviso interno de plazos de soporte (Postgres real)', () => {
  it('el barrido previo publica support.sla.warning al outbox con versión e idempotencia, y anota el umbral', async () => {
    if (!database) return;

    const result = await sla.sweepWarnings(ids.tenant);

    expect(result.warned).toBe(1);
    const rows = await outboxRows('support.sla.warning');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      aggregateType: 'support_case',
      aggregateId: ids.caseId,
      status: 'pending',
      sourceModule: 'support',
      sourceAction: 'sweep_sla_warnings',
      idempotencyKey: `support-sla-warning-${ids.clock}-80`,
    });
    expect(String(rows[0]!.aggregateVersion)).toBe('1');
    expect(rows[0]!.eventPayloadJson).toMatchObject({
      caseId: ids.caseId,
      metricType: 'RESOLUTION',
      reachedPercents: [50, 80],
      reachedPercent: 80,
    });
    const clock = await SupportSlaClockModel.findByPk(ids.clock);
    expect(clock?.warnedPercentsJson).toEqual([50, 80]);
    expect(await SupportCaseEventModel.count({ where: { tenantId: ids.tenant, caseId: ids.caseId, eventType: 'SLA_WARNING' } })).toBe(1);
  });

  it('una segunda pasada no repite el aviso (el umbral ya quedó anotado)', async () => {
    if (!database) return;

    const result = await sla.sweepWarnings(ids.tenant);

    expect(result.warned).toBe(0);
    expect(await outboxRows('support.sla.warning')).toHaveLength(1);
  });

  it('el orquestador lo convierte en UN mensaje de bandeja para operaciones, con la plantilla real', async () => {
    if (!database) return;
    const [event] = await outboxRows('support.sla.warning');

    await orchestrator.handleEvent(event!);

    const messages = await messagesOf(String(event!.id));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      recipientType: 'operations',
      recipientId: 'operations',
      channel: 'in_app',
      templateCode: 'support_sla_warning_in_app',
    });
    expect(messages[0]!.title).toBe('Un caso de soporte está por incumplir su plazo');
    expect(messages[0]!.body).toContain(`El caso ${ids.caseId} ya consumió el 80 % de su plazo (RESOLUTION)`);
    expect(messages[0]!.body).toMatch(/quedan unos 20 minutos/);
  });

  it('al vencer, el barrido publica support.sla.breached con la versión siguiente y también llega a operaciones', async () => {
    if (!database) return;
    await database.sequelize.query(`UPDATE support.support_sla_clocks SET target_at = now() - interval '5 minutes' WHERE _id = $clock`, {
      bind: { clock: ids.clock },
    });

    const result = await sla.sweepBreaches(ids.tenant);

    expect(result.breached).toBe(1);
    const rows = await outboxRows('support.sla.breached');
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.aggregateVersion)).toBe('2'); // la del aviso previo era la 1
    expect(rows[0]!.idempotencyKey).toBe(`support-sla-breach-${ids.clock}`);

    await orchestrator.handleEvent(rows[0]!);
    const messages = await messagesOf(String(rows[0]!.id));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ recipientType: 'operations', channel: 'in_app', templateCode: 'support_sla_breached_in_app' });
    expect(messages[0]!.title).toBe('Un caso de soporte incumplió su plazo');
    expect(messages[0]!.body).toContain(`El caso ${ids.caseId} venció su plazo (RESOLUTION)`);
  });

  /* En negativo: un evento de soporte SIN regla (la escalación) sigue sin generar mensaje. */
  it('un evento de soporte sin regla de canal no genera mensaje', async () => {
    if (!database) return;
    const now = new Date();
    const row = await OutboxEventModel.create({
      tenantId: ids.tenant,
      aggregateType: 'support_case',
      aggregateId: ids.caseId,
      eventCode: 'support.case.escalated',
      eventPayloadJson: { caseId: ids.caseId },
      eventFamily: 'support',
      eventVersion: 1,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);

    await orchestrator.handleEvent(row);

    expect(await messagesOf(String(row.id))).toHaveLength(0);
  });
});
