/**
 * @file Contratos de entrada: el sobre y los payloads de atlas-integration-v1 que Core consume.
 * @business Un evento del ERP que no cumple el contrato se rechaza entero (422) y el ERP lo deja en
 *   DEAD, visible: nunca se aplica a medias ni se adivina un campo.
 * @system Espejo en Zod de contracts/atlas-integration-v1/schemas; las pruebas de conformidad pasan los
 *   MISMOS fixtures por estos esquemas y por el JSON Schema, así que divergir los pone en rojo.
 */
import { z } from 'zod';

const coreId = z.string().regex(/^[1-9][0-9]{0,18}$/u);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const isoDateTime = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/u);
const decimalAmount = z.string().regex(/^[0-9]{1,16}(\.[0-9]{1,2})?$/u);
const positiveDecimalAmount = decimalAmount.refine((value) => /[1-9]/u.test(value), 'El importe debe ser mayor que cero.');
const currency = z.string().regex(/^[A-Z]{3}$/u);

export const ENVELOPE_SPECS = ['atlas.erp.outbox/1', 'atlas.core.outbox/1'] as const;

export const integrationEnvelopeSchema = z.strictObject({
  spec: z.enum(ENVELOPE_SPECS),
  eventKey: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/u),
  topic: z
    .string()
    .max(120)
    .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/u),
  schemaVersion: z.number().int().min(1),
  aggregate: z.strictObject({
    type: z.string().min(1).max(80),
    id: z.string().min(1).max(120),
    version: z.number().int().min(1),
  }),
  occurredAt: isoDateTime,
  producer: z.enum(['atlas-erp', 'atlas-core']),
  tenantId: coreId.optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type IntegrationEnvelope = z.infer<typeof integrationEnvelopeSchema>;

const coreRefSchema = z.strictObject({
  tenantId: coreId,
  loanId: coreId,
  installmentId: coreId,
  partnerProfileId: coreId.nullable().optional(),
});
export type CoreRef = z.infer<typeof coreRefSchema>;

export const coverageSettledPayloadSchema = z.strictObject({
  payableId: uuid,
  installmentId: uuid,
  purchaseId: uuid,
  merchantAccountId: uuid,
  consumerId: uuid,
  settlementId: uuid,
  settlementReference: z.string().min(1).max(120),
  amount: positiveDecimalAmount,
  currency,
  paidAt: isoDateTime,
  recoveryId: uuid,
  coreRef: coreRefSchema.nullable(),
});
export type CoverageSettledPayload = z.infer<typeof coverageSettledPayloadSchema>;

export const RECOVERY_STATUSES = ['OPEN', 'IN_COLLECTION', 'PARTIALLY_RECOVERED', 'RECOVERED', 'WRITTEN_OFF'] as const;

export const recoveryMovementPayloadSchema = z.strictObject({
  recoveryId: uuid,
  installmentId: uuid,
  consumerId: uuid,
  movementId: uuid,
  movementType: z.enum(['PAYMENT', 'REVERSAL']),
  paymentReference: z.string().min(1).max(120),
  amount: positiveDecimalAmount,
  currency,
  amountRecovered: decimalAmount,
  recoveryStatus: z.enum(RECOVERY_STATUSES),
  coreRef: coreRefSchema.nullable(),
});
export type RecoveryMovementPayload = z.infer<typeof recoveryMovementPayloadSchema>;

/** Tópicos del ERP que Core consume con efecto, con su esquema de payload y la versión que entiende. */
export const CONSUMED_ERP_TOPICS = {
  'b2b.coverage.settled': { schemaVersion: 1, payload: coverageSettledPayloadSchema },
  'b2b.recovery.payment_applied': { schemaVersion: 1, payload: recoveryMovementPayloadSchema },
  'b2b.recovery.payment_reversed': { schemaVersion: 1, payload: recoveryMovementPayloadSchema },
} as const;
export type ConsumedErpTopic = keyof typeof CONSUMED_ERP_TOPICS;

export function isConsumedErpTopic(topic: string): topic is ConsumedErpTopic {
  return Object.prototype.hasOwnProperty.call(CONSUMED_ERP_TOPICS, topic);
}
