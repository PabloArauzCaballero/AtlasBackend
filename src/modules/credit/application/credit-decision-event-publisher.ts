/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Avisa al ERP la decisión de crédito (T-11) para que su regla de MDR por banda (§1.2 del
 *   plan) case en el registro de la compra. Sólo se avisa una aprobación CON banda real.
 * @system publica `credit.decision.recorded` en la MISMA transacción que escribió la solicitud
 *   (P-08): si el guardado se revierte, el evento nunca existió; si éste fallara, la transacción
 *   entera se revierte y `application.save()` tampoco queda.
 */
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import type { EventsService } from '../../events/events.service.js';

/**
 * La versión siguiente del agregado `credit_application` en el outbox (mismo criterio que
 * `nextInstallmentVersion` en avisos de pago): el máximo ya escrito, más uno. Sólo se llama una vez
 * por solicitud —la guarda `previousStatus !== 'submitted'` de quien invoca lo asegura—, así que no
 * hace falta un cerrojo propio para que esta cuenta no colisione.
 */
async function nextCreditApplicationVersion(
  sequelize: Sequelize,
  tenantId: string,
  applicationId: string,
  transaction: Transaction,
): Promise<number> {
  const rows = await sequelize.query<{ version: string | null }>(
    `SELECT MAX(aggregate_version)::text AS version FROM ${atlasSchemaFor('outbox_events')}.outbox_events
      WHERE _tenant_id = $tenantId AND aggregate_type = $aggregateType AND aggregate_id = $applicationId`,
    {
      type: QueryTypes.SELECT,
      bind: { tenantId, aggregateType: 'credit_application', applicationId },
      transaction,
    },
  );
  return Number(rows[0]?.version ?? 0) + 1;
}

export async function publishCreditDecisionRecorded(params: {
  sequelize: Sequelize;
  events: EventsService;
  input: { tenantId: string; applicationCode: string; customerId: string };
  applicationId: string;
  riskBand: string;
  now: Date;
  transaction: Transaction;
}): Promise<void> {
  const { sequelize, events, input, applicationId, riskBand, now, transaction } = params;
  const aggregateVersion = await nextCreditApplicationVersion(sequelize, input.tenantId, applicationId, transaction);
  await events.publish(
    {
      tenantId: input.tenantId,
      eventCode: 'credit.decision.recorded',
      aggregateType: 'credit_application',
      aggregateId: applicationId,
      aggregateVersion,
      payload: {
        customerId: input.customerId,
        riskBand,
        decidedAt: now.toISOString(),
        applicationCode: input.applicationCode,
      },
    },
    { transaction },
  );
}
