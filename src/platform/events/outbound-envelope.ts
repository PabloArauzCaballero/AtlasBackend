/**
 * @file El sobre que Core entrega a otro servicio (contracts/atlas-integration-v1, `atlas.core.outbox/1`).
 * @business Lo que sale de Core hacia el ERP es EXACTAMENTE lo que dice el contrato: ni un campo de más
 *   (la referencia bancaria del cliente se queda en Core), ni un número donde el contrato pide texto.
 * @system Proyecta la fila del outbox a un sobre con la misma forma que el del ERP: clave de evento =
 *   `event_id` del outbox, agregado con versión y tenant. Por tópico, una lista de campos permitidos.
 */
export const CORE_ENVELOPE_SPEC = 'atlas.core.outbox/1';

const CLAIM_FIELDS = [
  'claimId',
  'claimCode',
  'loanId',
  'installmentId',
  'customerId',
  'partnerProfileId',
  'amount',
  'currencyCode',
  'aggregateVersion',
];

// T-11: la banda de riesgo con la que se aprobó un crédito, para que el ERP pueda casar su regla de
// MDR por banda (§1.2 del plan) en el registro de la compra. Sólo estos cuatro campos — el contrato
// del ERP (`atlas.core.outbox/1`) es la lista blanca; nada del expediente que no esté aquí sale.
const CREDIT_DECISION_FIELDS = ['customerId', 'riskBand', 'decidedAt', 'applicationCode'];

/** Campos del contrato por tópico. Un tópico sin entrada no se puede entregar (falla al encolar). */
export const OUTBOUND_PAYLOAD_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'payment.reported': CLAIM_FIELDS,
  'payment.confirmed': [...CLAIM_FIELDS, 'decidedAt', 'loanPaymentId'],
  'payment.rejected': [...CLAIM_FIELDS, 'decidedAt', 'reason'],
  'credit.decision.recorded': CREDIT_DECISION_FIELDS,
});

export type CoreOutboundEnvelope = Readonly<{
  spec: typeof CORE_ENVELOPE_SPEC;
  eventKey: string;
  topic: string;
  schemaVersion: number;
  aggregate: Readonly<{ type: string; id: string; version: number }>;
  occurredAt: string;
  producer: 'atlas-core';
  tenantId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

function contractValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return value ?? null;
}

export function buildCoreEnvelope(row: {
  eventId: string;
  eventCode: string;
  schemaVersion?: number | null;
  tenantId: string | number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  createdAtValue: Date;
  eventPayloadJson: Record<string, unknown> | null;
}): CoreOutboundEnvelope {
  const fields = OUTBOUND_PAYLOAD_FIELDS[row.eventCode];
  if (!fields) throw new Error(`OUTBOUND_TOPIC_WITHOUT_CONTRACT: ${row.eventCode}`);
  const source = row.eventPayloadJson ?? {};
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    // La versión viaja como entero (así la declara el contrato); el resto de identificadores, como texto.
    payload[field] = field === 'aggregateVersion' ? row.aggregateVersion : contractValue(source[field]);
  }
  return Object.freeze({
    spec: CORE_ENVELOPE_SPEC,
    eventKey: row.eventId,
    topic: row.eventCode,
    schemaVersion: row.schemaVersion ?? 1,
    aggregate: Object.freeze({ type: row.aggregateType, id: row.aggregateId, version: row.aggregateVersion }),
    occurredAt: row.createdAtValue.toISOString(),
    producer: 'atlas-core',
    tenantId: String(row.tenantId),
    payload: Object.freeze(payload),
  });
}
