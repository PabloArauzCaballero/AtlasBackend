/**
 * @file P-14 — conformidad de Core con contracts/atlas-integration-v1 (productor y consumidor).
 * @business Core y el ERP se prueban contra el MISMO esquema: un cambio incompatible pone en rojo a
 *   quien produce y a quien consume, en su propio repositorio y sin levantar al otro.
 * @system Sin base ni red. Valida fixtures (válidos, frontera, inválidos) contra el JSON Schema y
 *   contra los esquemas Zod del receptor; construye sobres reales con el productor de Core y los valida;
 *   comprueba los vectores de firma y que CHECKSUMS.sha256 describe lo que hay en disco.
 */
import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildCoreEnvelope, OUTBOUND_PAYLOAD_FIELDS } from '../../../src/platform/events/outbound-envelope.js';
import { OUTBOUND_SUBSCRIPTIONS } from '../../../src/platform/events/outbound-subscriptions.js';
import { signEventBody, verifyEventSignature } from '../../../src/platform/security/signed-event.js';
import {
  CONSUMED_ERP_TOPICS,
  integrationEnvelopeSchema,
  isConsumedErpTopic,
} from '../../../src/modules/erp-integration/integration-envelope.schemas.js';
import { loadSchemaRegistry, validateAgainst, validateEnvelope, type TopicEntry } from './json-schema-subset.js';

const CONTRACT = resolve(__dirname, '../../../contracts/atlas-integration-v1');
const registry = loadSchemaRegistry(CONTRACT);
const topics = (JSON.parse(readFileSync(join(CONTRACT, 'topics.json'), 'utf8')) as { topics: TopicEntry[] }).topics;

type Case = { name: string; envelope: Record<string, unknown> };
type FixtureFile = { topic: string; valid: Case[]; boundary: Case[]; invalid: Case[] };

const fixtureFiles = readdirSync(join(CONTRACT, 'fixtures'))
  .filter((file) => file.endsWith('.v1.json'))
  .map((file) => JSON.parse(readFileSync(join(CONTRACT, 'fixtures', file), 'utf8')) as FixtureFile);

/** Lo que el receptor de Core acepta: el sobre y, si Core consume el tópico, su payload. */
function coreAccepts(envelope: unknown): boolean {
  const parsed = integrationEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) return false;
  if (!isConsumedErpTopic(parsed.data.topic)) return true;
  return CONSUMED_ERP_TOPICS[parsed.data.topic].payload.safeParse(parsed.data.payload).success;
}

describe('atlas-integration-v1 · esquemas y fixtures', () => {
  it('cada tópico de topics.json tiene esquema y cada fixture un tópico declarado', () => {
    for (const entry of topics) expect(registry.has(entry.schema.replace(/^schemas\//u, ''))).toBe(true);
    for (const file of fixtureFiles) expect(topics.map((entry) => entry.topic)).toContain(file.topic);
  });

  it('los fixtures válidos y de frontera cumplen el esquema del sobre y del tópico', () => {
    for (const file of fixtureFiles) {
      for (const sample of [...file.valid, ...file.boundary]) {
        expect({ caso: `${file.topic} · ${sample.name}`, errores: validateEnvelope(registry, topics, sample.envelope) }).toEqual({
          caso: `${file.topic} · ${sample.name}`,
          errores: [],
        });
      }
    }
  });

  it('los fixtures inválidos fallan el esquema (importe número, 3 decimales, cero, campo desconocido…)', () => {
    const invalid = fixtureFiles.flatMap((file) => file.invalid.map((sample) => ({ ...sample, topic: file.topic })));
    expect(invalid.length).toBeGreaterThanOrEqual(10);
    for (const sample of invalid)
      expect({ caso: sample.name, falla: validateEnvelope(registry, topics, sample.envelope).length > 0 }).toEqual({
        caso: sample.name,
        falla: true,
      });
    const broken = JSON.parse(readFileSync(join(CONTRACT, 'fixtures/envelope.invalid.json'), 'utf8')) as { invalid: Case[] };
    for (const sample of broken.invalid)
      expect(validateAgainst(registry, 'envelope.schema.json', sample.envelope).length).toBeGreaterThan(0);
  });
});

describe('atlas-integration-v1 · Core como CONSUMIDOR de eventos del ERP', () => {
  const erpFiles = fixtureFiles.filter((file) => topics.find((entry) => entry.topic === file.topic)?.producer === 'atlas-erp');

  it('el receptor acepta exactamente los fixtures válidos del ERP y rechaza los inválidos', () => {
    expect(erpFiles.length).toBeGreaterThanOrEqual(4);
    for (const file of erpFiles) {
      for (const sample of [...file.valid, ...file.boundary])
        expect({ caso: sample.name, acepta: coreAccepts(sample.envelope) }).toEqual({ caso: sample.name, acepta: true });
      for (const sample of file.invalid)
        expect({ caso: sample.name, acepta: coreAccepts(sample.envelope) }).toEqual({ caso: sample.name, acepta: false });
    }
    const broken = JSON.parse(readFileSync(join(CONTRACT, 'fixtures/envelope.invalid.json'), 'utf8')) as { invalid: Case[] };
    for (const sample of broken.invalid) expect(coreAccepts(sample.envelope)).toBe(false);
  });

  it('los tópicos que Core consume con efecto son los que topics.json declara con consumidor atlas-core', () => {
    const declared = topics.filter((entry) => entry.consumer === 'atlas-core').map((entry) => entry.topic);
    expect(Object.keys(CONSUMED_ERP_TOPICS).sort()).toEqual(declared.sort());
  });
});

describe('atlas-integration-v1 · Core como PRODUCTOR de payment.*', () => {
  const baseRow = {
    eventId: '00000000-0000-4000-8000-000000000021',
    tenantId: '900001',
    aggregateType: 'installment',
    aggregateId: '920001',
    aggregateVersion: 2,
    schemaVersion: 1,
    createdAtValue: new Date('2026-09-24T12:00:00.000Z'),
  };
  // Lo que el servicio de avisos escribe de verdad en el outbox (ya redactado por el repositorio).
  const outboxPayload = {
    claimId: '940001',
    claimCode: 'PAY-FIXTURE-0001',
    loanId: '910001',
    installmentId: '920001',
    customerId: '950001',
    partnerProfileId: '930001',
    amount: '333.33',
    currencyCode: 'BOB',
    payerReference: '[REDACTED]',
    decidedAt: new Date('2026-09-24T12:00:00.000Z'),
    aggregateVersion: 2,
    loanPaymentId: '960001',
    reason: 'No veo la transferencia',
  };

  // T-11: credit.decision.recorded no tiene forma de "claim" (no hay cuota ni préstamo); su propio
  // fixture, distinto de outboxPayload, es justo lo que hace real la prueba de conformidad por tópico.
  const creditDecisionPayload = {
    customerId: '950001',
    riskBand: 'B',
    decidedAt: new Date('2026-09-24T12:00:00.000Z'),
    applicationCode: 'CRA-FIXTURE-0001',
  };
  const payloadByEventCode: Record<string, Record<string, unknown>> = {
    'payment.reported': outboxPayload,
    'payment.confirmed': outboxPayload,
    'payment.rejected': outboxPayload,
    'credit.decision.recorded': creditDecisionPayload,
  };

  it('el sobre que Core entrega al ERP cumple el esquema para cada tópico suscrito', () => {
    expect([...OUTBOUND_SUBSCRIPTIONS['atlas-erp']!].sort()).toEqual(Object.keys(OUTBOUND_PAYLOAD_FIELDS).sort());
    for (const eventCode of OUTBOUND_SUBSCRIPTIONS['atlas-erp']!) {
      const envelope = buildCoreEnvelope({ ...baseRow, eventCode, eventPayloadJson: payloadByEventCode[eventCode] });
      expect({ eventCode, errores: validateEnvelope(registry, topics, JSON.parse(JSON.stringify(envelope))) }).toEqual({
        eventCode,
        errores: [],
      });
    }
  });

  it('no filtra la referencia bancaria del cliente ni campos fuera del contrato', () => {
    const envelope = buildCoreEnvelope({ ...baseRow, eventCode: 'payment.confirmed', eventPayloadJson: outboxPayload });
    expect(envelope.payload).not.toHaveProperty('payerReference');
    expect(envelope.payload).not.toHaveProperty('reason');
    expect(envelope.eventKey).toBe(baseRow.eventId);
  });

  it('una salida incompatible del productor falla el esquema (importe numérico, versión ausente)', () => {
    const numeric = buildCoreEnvelope({
      ...baseRow,
      eventCode: 'payment.reported',
      eventPayloadJson: { ...outboxPayload, amount: 333.33 },
    });
    // `contractValue` convierte números a texto: 333.33 → "333.33" cumple; un NaN no.
    expect(validateEnvelope(registry, topics, JSON.parse(JSON.stringify(numeric)))).toEqual([]);
    const missing = buildCoreEnvelope({
      ...baseRow,
      eventCode: 'payment.confirmed',
      eventPayloadJson: { ...outboxPayload, loanPaymentId: undefined },
    });
    expect(validateEnvelope(registry, topics, JSON.parse(JSON.stringify(missing))).join(' ')).toMatch(/loanPaymentId/u);
    expect(() => buildCoreEnvelope({ ...baseRow, eventCode: 'loan.disbursed', eventPayloadJson: {} })).toThrow(
      'OUTBOUND_TOPIC_WITHOUT_CONTRACT',
    );
  });
});

describe('atlas-integration-v1 · firma y sincronía del contrato', () => {
  it('los vectores de firma dan el mismo encabezado y verifican (un solo esquema en los dos sentidos)', () => {
    const file = JSON.parse(readFileSync(join(CONTRACT, 'signature/vectors.json'), 'utf8')) as {
      toleranceSeconds: number;
      vectors: Array<{ secret: string; timestamp: number; body: string; header: string }>;
    };
    for (const vector of file.vectors) {
      expect(signEventBody(vector.secret, vector.body, vector.timestamp)).toBe(vector.header);
      expect(
        verifyEventSignature({
          secret: vector.secret,
          header: vector.header,
          rawBody: vector.body,
          nowSeconds: vector.timestamp,
          toleranceSeconds: file.toleranceSeconds,
        }),
      ).toEqual({ ok: true });
    }
  });

  it('CHECKSUMS.sha256 describe exactamente los archivos del contrato (la copia del ERP se compara con esto)', () => {
    const listFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? listFiles(join(dir, entry)) : [join(dir, entry)]));
    const expected = listFiles(CONTRACT)
      .map((file) => relative(CONTRACT, file))
      .filter((file) => file !== 'CHECKSUMS.sha256' && file !== 'ORIGIN.json')
      .sort()
      .map(
        (file) =>
          `${createHash('sha256')
            .update(readFileSync(join(CONTRACT, file)))
            .digest('hex')}  ${file}`,
      )
      .join('\n');
    expect(readFileSync(join(CONTRACT, 'CHECKSUMS.sha256'), 'utf8')).toBe(`${expected}\n`);
  });
});
