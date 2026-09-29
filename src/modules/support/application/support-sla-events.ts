/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Un plazo que está por vencer o que venció le llega a operaciones como aviso, y el aviso no se duplica ni se pierde.
 * @system publica `support.sla.warning` y `support.sla.breached` al outbox con versión de agregado e idempotencia.
 */
import { Logger } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import type { SupportCaseRepository } from '../support-case.repository.js';

/**
 * Lo único que estos ayudantes piden del publicador de eventos (`EventsService.publish`). Se declara aquí
 * y no se importa el servicio: `support` no puede depender del módulo `events` más allá de lo que ya tiene
 * `SupportSlaService`, y así una prueba pasa un doble sin construir el servicio.
 */
export type SlaEventPublisher = {
  publish(input: {
    tenantId: string;
    eventCode: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    sourceModule: string;
    sourceAction: string;
  }): Promise<unknown>;
};

export type SlaClockEvent = {
  tenantId: string;
  eventCode: 'support.sla.warning' | 'support.sla.breached';
  clock: { id: string | number; caseId: string | number };
  payload: Record<string, unknown>;
  idempotencyKey: string;
  sourceAction: string;
};

/**
 * La versión siguiente del agregado `support_case` en el outbox: el máximo ya escrito, más uno. Es la
 * misma cuenta que `nextInstallmentVersion`; un consumidor que ya aplicó la N descarta la N-1 que llegue
 * tarde. Los barridos corren en serie por tenant y la clave de idempotencia protege del doble aviso aunque
 * dos barridos (el del job y el manual) coincidieran.
 */
export async function nextCaseEventVersion(sequelize: Sequelize, tenantId: string, caseId: string): Promise<number> {
  const rows = await sequelize.query<{ version: string | null }>(
    `SELECT MAX(aggregate_version)::text AS version FROM ${atlasSchemaFor('outbox_events')}.outbox_events
      WHERE _tenant_id = $tenantId AND aggregate_type = 'support_case' AND aggregate_id = $caseId`,
    { type: QueryTypes.SELECT, bind: { tenantId, caseId } },
  );
  return Number(rows[0]?.version ?? 0) + 1;
}

/**
 * Publica el evento de un reloj en el outbox. Devuelve `false` si no se pudo, sin lanzar: un fallo del
 * outbox no puede tumbar el barrido, que tiene que seguir con el resto de los relojes. Quien llama decide
 * si el reintento es la pasada siguiente.
 */
export async function publishSlaClockEvent(
  deps: { events: SlaEventPublisher; sequelize: Sequelize; logger: Logger },
  input: SlaClockEvent,
): Promise<boolean> {
  try {
    await deps.events.publish({
      tenantId: input.tenantId,
      eventCode: input.eventCode,
      aggregateType: 'support_case',
      aggregateId: String(input.clock.caseId),
      aggregateVersion: await nextCaseEventVersion(deps.sequelize, input.tenantId, String(input.clock.caseId)),
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      sourceModule: 'support',
      sourceAction: input.sourceAction,
    });
    return true;
  } catch (error) {
    deps.logger.warn(`No se pudo publicar ${input.eventCode} para el reloj ${input.clock.id}: ${String(error)}`);
    return false;
  }
}

/**
 * Escribe el evento del reloj en la historia del caso, con su propia transacción.
 *
 * El actor es `SYSTEM` porque nadie decidió esto: lo decidió el tiempo. Un fallo al escribir no puede
 * tumbar el barrido —el resto de relojes tiene que seguir revisándose—, así que se registra y se continúa;
 * la marca en el reloj ya está puesta y es la que sostiene la medición.
 */
export async function recordSlaCaseEvent(
  deps: { cases: SupportCaseRepository; sequelize: Sequelize; logger: Logger },
  input: { tenantId: string; caseId: string; eventType: 'SLA_BREACHED' | 'SLA_WARNING'; payload: Record<string, unknown> },
): Promise<void> {
  const { tenantId, caseId, eventType, payload } = input;
  try {
    await deps.sequelize.transaction(async (transaction) => {
      await deps.cases.appendEvent(
        { tenantId, caseId: String(caseId), eventType, actorType: 'SYSTEM', actorId: 'system', payload },
        transaction,
      );
    });
  } catch (error) {
    deps.logger.warn(`No se pudo escribir ${eventType} en el caso ${caseId}: ${String(error)}`);
  }
}
