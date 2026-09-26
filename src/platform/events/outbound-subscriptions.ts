/**
 * @file Suscripciones SALIENTES del outbox: qué eventos de Core debe recibir otro servicio (P-14).
 * @business El aviso de pago confirmado en Core tiene que llegar al ERP, que decide si detiene una
 *   cobertura: si el aviso existe, su entrega pendiente también existe, porque nacen en la misma
 *   transacción. Nunca «se publicó el aviso pero nadie se acordó de mandarlo».
 * @system Una fila en `outbound_event_deliveries` por (destino, evento) escrita con la transacción de
 *   quien publica. La entrega (firma, reintentos, orden por agregado) la hace el trabajo del destino;
 *   el estado `processed` del outbox sigue siendo sólo de las notificaciones.
 */
import type { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { buildCoreEnvelope } from './outbound-envelope.js';

export const OUTBOUND_SUBSCRIPTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'atlas-erp': Object.freeze(['payment.reported', 'payment.confirmed', 'payment.rejected']),
});

const DELIVERIES = `${atlasSchemaFor('outbound_event_deliveries')}.outbound_event_deliveries`;

export function destinationsFor(eventCode: string): string[] {
  return Object.entries(OUTBOUND_SUBSCRIPTIONS)
    .filter(([, codes]) => codes.includes(eventCode))
    .map(([destination]) => destination);
}

export type OutboundEventRow = {
  eventId: string;
  eventCode: string;
  tenantId: string | number | null;
  aggregateType: string;
  aggregateId: string | null;
  aggregateVersion?: string | number | null;
  schemaVersion?: number | null;
  createdAtValue: Date;
  eventPayloadJson: Record<string, unknown> | null;
};

/**
 * Encola la entrega a cada destino suscrito. Idempotente (`ON CONFLICT DO NOTHING`). Un evento
 * suscrito sin tenant, agregado o versión no se puede entregar en orden: falla la transacción entera
 * en vez de publicar un aviso que el ERP no recibiría nunca.
 */
export async function enqueueOutboundDeliveries(sequelize: Sequelize, row: OutboundEventRow, transaction?: Transaction): Promise<number> {
  const destinations = destinationsFor(row.eventCode);
  if (destinations.length === 0) return 0;
  const version = row.aggregateVersion === null || row.aggregateVersion === undefined ? null : Number(row.aggregateVersion);
  if (row.tenantId === null || !row.aggregateId || version === null || !Number.isInteger(version) || version < 1) {
    throw new Error(
      `OUTBOUND_EVENT_WITHOUT_ORDER: ${row.eventCode} necesita tenant, agregado y versión para entregarse a ${destinations.join(',')}.`,
    );
  }
  // Campo a campo y no `{ ...row }`: la fila es un modelo de Sequelize y sus atributos son getters.
  const envelope = buildCoreEnvelope({
    eventId: row.eventId,
    eventCode: row.eventCode,
    schemaVersion: row.schemaVersion,
    tenantId: row.tenantId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateVersion: version,
    createdAtValue: row.createdAtValue,
    eventPayloadJson: row.eventPayloadJson,
  });
  for (const destination of destinations) {
    await sequelize.query(
      `INSERT INTO ${DELIVERIES} (_tenant_id, destination, event_id, event_code, aggregate_type, aggregate_id, aggregate_version, envelope)
       VALUES ($tenantId, $destination, $eventId, $eventCode, $aggregateType, $aggregateId, $version, $envelope::jsonb)
       ON CONFLICT (destination, event_id) DO NOTHING`,
      {
        transaction,
        bind: {
          tenantId: String(row.tenantId),
          destination,
          eventId: row.eventId,
          eventCode: row.eventCode,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          version,
          envelope: JSON.stringify(envelope),
        },
      },
    );
  }
  return destinations.length;
}
