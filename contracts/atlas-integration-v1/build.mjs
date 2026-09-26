#!/usr/bin/env node
/**
 * Genera, de forma DETERMINISTA, los fixtures, los vectores de firma y CHECKSUMS.sha256 del
 * contrato atlas-integration-v1. Sin dependencias: sólo `node:crypto` y `node:fs`.
 *
 *   node contracts/atlas-integration-v1/build.mjs          # reescribe
 *   node contracts/atlas-integration-v1/build.mjs --check  # falla si lo escrito no coincide
 *
 * Reglas de los datos: importes como TEXTO decimal, reloj fijo (2026-09-24T12:00:00.000Z), UUID
 * sintéticos (00000000-0000-4000-8000-…) e identificadores de Core numéricos inventados (9xxxxx).
 * Ningún dato personal real.
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHECK = process.argv.includes('--check');
const CLOCK = '2026-09-24T12:00:00.000Z';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const coreRef = { tenantId: '900001', loanId: '910001', installmentId: '920001', partnerProfileId: '930001' };

function coreEnvelope(topic, eventNumber, version, payload) {
  return {
    spec: 'atlas.core.outbox/1',
    eventKey: uuid(eventNumber),
    topic,
    schemaVersion: 1,
    aggregate: { type: 'installment', id: '920001', version },
    occurredAt: CLOCK,
    producer: 'atlas-core',
    tenantId: '900001',
    payload,
  };
}

function erpEnvelope(topic, eventKey, aggregate, payload) {
  return {
    spec: 'atlas.erp.outbox/1',
    eventKey,
    topic,
    schemaVersion: 1,
    aggregate,
    occurredAt: CLOCK,
    producer: 'atlas-erp',
    payload,
  };
}

const claimBase = {
  claimId: '940001',
  claimCode: 'PAY-FIXTURE-0001',
  loanId: '910001',
  installmentId: '920001',
  customerId: '950001',
  partnerProfileId: '930001',
  amount: '333.33',
  currencyCode: 'BOB',
};

const reported = { ...claimBase, aggregateVersion: 1 };
const confirmed = { ...claimBase, decidedAt: CLOCK, aggregateVersion: 2, loanPaymentId: '960001' };
const rejected = { ...claimBase, decidedAt: CLOCK, aggregateVersion: 2, reason: 'No veo la transferencia' };

const settled = {
  payableId: uuid(101),
  installmentId: uuid(102),
  purchaseId: uuid(103),
  merchantAccountId: uuid(104),
  consumerId: uuid(105),
  settlementId: uuid(106),
  settlementReference: 'LIQ-FIXTURE-0001',
  amount: '300.00',
  currency: 'BOB',
  paidAt: CLOCK,
  recoveryId: uuid(107),
  coreRef,
};

const movement = {
  recoveryId: uuid(107),
  installmentId: uuid(102),
  consumerId: uuid(105),
  movementId: uuid(108),
  movementType: 'PAYMENT',
  paymentReference: 'REC-FIXTURE-0001',
  amount: '100.00',
  currency: 'BOB',
  amountRecovered: '100.00',
  recoveryStatus: 'PARTIALLY_RECOVERED',
  coreRef,
};

const without = (object, key) => Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));

/** Casos por tópico. `invalid` DEBE fallar el esquema (y el consumidor debe responder 422). */
const FIXTURES = {
  'payment.reported': {
    valid: [{ name: 'aviso con comercio', envelope: coreEnvelope('payment.reported', 1, 1, reported) }],
    boundary: [
      { name: 'importe mínimo 0.01', envelope: coreEnvelope('payment.reported', 2, 1, { ...reported, amount: '0.01' }) },
      { name: 'importe sin decimales', envelope: coreEnvelope('payment.reported', 3, 1, { ...reported, amount: '333' }) },
      { name: 'importe máximo de 16 enteros', envelope: coreEnvelope('payment.reported', 4, 1, { ...reported, amount: '9999999999999999.99' }) },
      { name: 'sin comercio (partnerProfileId null)', envelope: coreEnvelope('payment.reported', 5, 1, { ...reported, partnerProfileId: null }) },
    ],
    invalid: [
      { name: 'importe como número JSON', envelope: coreEnvelope('payment.reported', 6, 1, { ...reported, amount: 333.33 }) },
      { name: 'importe con tres decimales', envelope: coreEnvelope('payment.reported', 7, 1, { ...reported, amount: '333.333' }) },
      { name: 'importe cero', envelope: coreEnvelope('payment.reported', 8, 1, { ...reported, amount: '0.00' }) },
      { name: 'importe negativo', envelope: coreEnvelope('payment.reported', 9, 1, { ...reported, amount: '-1.00' }) },
      { name: 'sin installmentId', envelope: coreEnvelope('payment.reported', 10, 1, without(reported, 'installmentId')) },
      { name: 'campo desconocido', envelope: coreEnvelope('payment.reported', 11, 1, { ...reported, payerReference: 'X' }) },
      { name: 'moneda en minúsculas', envelope: coreEnvelope('payment.reported', 12, 1, { ...reported, currencyCode: 'bob' }) },
    ],
  },
  'payment.confirmed': {
    valid: [{ name: 'confirmación del comercio', envelope: coreEnvelope('payment.confirmed', 21, 2, confirmed) }],
    boundary: [
      { name: 'decidedAt con desfase horario', envelope: coreEnvelope('payment.confirmed', 22, 2, { ...confirmed, decidedAt: '2026-09-24T08:00:00-04:00' }) },
    ],
    invalid: [
      { name: 'sin loanPaymentId', envelope: coreEnvelope('payment.confirmed', 23, 2, without(confirmed, 'loanPaymentId')) },
      { name: 'loanId no numérico', envelope: coreEnvelope('payment.confirmed', 24, 2, { ...confirmed, loanId: 'abc' }) },
      { name: 'decidedAt sin zona', envelope: coreEnvelope('payment.confirmed', 25, 2, { ...confirmed, decidedAt: '2026-09-24 12:00:00' }) },
    ],
  },
  'payment.rejected': {
    valid: [{ name: 'rechazo con motivo', envelope: coreEnvelope('payment.rejected', 31, 2, rejected) }],
    boundary: [{ name: 'rechazo sin motivo (null)', envelope: coreEnvelope('payment.rejected', 32, 2, { ...rejected, reason: null }) }],
    invalid: [{ name: 'sin reason', envelope: coreEnvelope('payment.rejected', 33, 2, without(rejected, 'reason')) }],
  },
  'b2b.coverage.settled': {
    valid: [
      {
        name: 'cobertura liquidada de cuota mapeada',
        envelope: erpEnvelope('b2b.coverage.settled', `coverage-settled-${uuid(101)}`, { type: 'merchant_payable', id: uuid(101), version: 2 }, settled),
      },
    ],
    boundary: [
      {
        name: 'cuota sin mapeo a Core (coreRef null)',
        envelope: erpEnvelope('b2b.coverage.settled', `coverage-settled-${uuid(111)}`, { type: 'merchant_payable', id: uuid(111), version: 1 }, { ...settled, payableId: uuid(111), coreRef: null }),
      },
    ],
    invalid: [
      {
        name: 'importe como número',
        envelope: erpEnvelope('b2b.coverage.settled', `coverage-settled-${uuid(121)}`, { type: 'merchant_payable', id: uuid(121), version: 1 }, { ...settled, amount: 300 }),
      },
      {
        name: 'sin coreRef (debe venir, aunque sea null)',
        envelope: erpEnvelope('b2b.coverage.settled', `coverage-settled-${uuid(122)}`, { type: 'merchant_payable', id: uuid(122), version: 1 }, without(settled, 'coreRef')),
      },
      {
        name: 'coreRef con loanId no numérico',
        envelope: erpEnvelope('b2b.coverage.settled', `coverage-settled-${uuid(123)}`, { type: 'merchant_payable', id: uuid(123), version: 1 }, { ...settled, coreRef: { ...coreRef, loanId: 'L-1' } }),
      },
    ],
  },
  'b2b.recovery.payment_applied': {
    valid: [
      {
        name: 'pago de recuperación parcial',
        envelope: erpEnvelope('b2b.recovery.payment_applied', `recovery-movement-${uuid(108)}`, { type: 'consumer_recovery', id: uuid(107), version: 2 }, movement),
      },
    ],
    boundary: [
      {
        name: 'recuperación total',
        envelope: erpEnvelope('b2b.recovery.payment_applied', `recovery-movement-${uuid(109)}`, { type: 'consumer_recovery', id: uuid(107), version: 3 }, { ...movement, movementId: uuid(109), amount: '200.00', amountRecovered: '300.00', recoveryStatus: 'RECOVERED' }),
      },
    ],
    invalid: [
      {
        name: 'estado de recuperación desconocido',
        envelope: erpEnvelope('b2b.recovery.payment_applied', `recovery-movement-${uuid(131)}`, { type: 'consumer_recovery', id: uuid(107), version: 4 }, { ...movement, movementId: uuid(131), recoveryStatus: 'CLOSED' }),
      },
    ],
  },
  'b2b.recovery.payment_reversed': {
    valid: [
      {
        name: 'reverso de un pago de recuperación',
        envelope: erpEnvelope('b2b.recovery.payment_reversed', `recovery-movement-${uuid(141)}`, { type: 'consumer_recovery', id: uuid(107), version: 4 }, { ...movement, movementId: uuid(141), movementType: 'REVERSAL', amountRecovered: '0.00', recoveryStatus: 'OPEN' }),
      },
    ],
    boundary: [],
    invalid: [],
  },
  'accounting.document.posted': {
    valid: [
      {
        name: 'asiento publicado (Core lo acusa sin efecto)',
        envelope: erpEnvelope('accounting.document.posted', `accounting-posted-${uuid(151)}`, { type: 'accounting_document', id: uuid(151), version: 2 }, { accountingDocumentId: uuid(151), hashSha256: 'ab'.repeat(32) }),
      },
    ],
    boundary: [],
    invalid: [],
  },
};

/** Sobres que fallan el ESQUEMA DEL SOBRE, sea cual sea el tópico. */
const ENVELOPE_INVALID = [
  { name: 'spec desconocido', envelope: { ...coreEnvelope('payment.reported', 201, 1, reported), spec: 'atlas.core.outbox/2' } },
  { name: 'versión de agregado 0', envelope: coreEnvelope('payment.reported', 202, 0, reported) },
  { name: 'sin aggregate', envelope: without(coreEnvelope('payment.reported', 203, 1, reported), 'aggregate') },
  { name: 'eventKey con espacios', envelope: { ...coreEnvelope('payment.reported', 204, 1, reported), eventKey: 'a b' } },
  { name: 'occurredAt no ISO', envelope: { ...coreEnvelope('payment.reported', 205, 1, reported), occurredAt: 'ayer' } },
  { name: 'productor desconocido', envelope: { ...coreEnvelope('payment.reported', 206, 1, reported), producer: 'atlas-engine' } },
];

/** Vectores de firma: el MISMO esquema HMAC en los dos sentidos. */
const SIGNING_SECRET = 'atlas-contract-fixture-secret-0000000000000000';
const SIGNATURE_VECTORS = [
  { name: 'sobre de Core', timestamp: 1790251200, body: JSON.stringify(FIXTURES['payment.confirmed'].valid[0].envelope) },
  { name: 'sobre del ERP', timestamp: 1790251200, body: JSON.stringify(FIXTURES['b2b.coverage.settled'].valid[0].envelope) },
  { name: 'cuerpo vacío', timestamp: 1, body: '' },
].map((vector) => ({
  ...vector,
  secret: SIGNING_SECRET,
  header: `t=${vector.timestamp},v1=${createHmac('sha256', SIGNING_SECRET).update(`${vector.timestamp}.${vector.body}`).digest('hex')}`,
}));

const outputs = new Map();
for (const [topic, cases] of Object.entries(FIXTURES)) {
  outputs.set(`fixtures/${topic}.v1.json`, { topic, ...cases });
}
outputs.set('fixtures/envelope.invalid.json', { invalid: ENVELOPE_INVALID });
outputs.set('signature/vectors.json', {
  scheme: 'x-atlas-signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, "<t>.<cuerpo crudo>"))>',
  toleranceSeconds: 300,
  vectors: SIGNATURE_VECTORS,
});

let drift = false;
for (const [path, value] of outputs) {
  const full = join(ROOT, path);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  let current = null;
  try {
    current = readFileSync(full, 'utf8');
  } catch {
    current = null;
  }
  if (current !== text) {
    drift = true;
    if (CHECK) console.error(`difiere: ${path}`);
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
  }
}

/** CHECKSUMS: todo el contrato menos el propio archivo. La copia del ERP se compara contra esto. */
function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}
const sums = listFiles(ROOT)
  .map((file) => relative(ROOT, file))
  .filter((file) => file !== 'CHECKSUMS.sha256' && file !== 'ORIGIN.json')
  .sort()
  .map((file) => `${createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex')}  ${file}`)
  .join('\n');
const sumsPath = join(ROOT, 'CHECKSUMS.sha256');
let currentSums = null;
try {
  currentSums = readFileSync(sumsPath, 'utf8');
} catch {
  currentSums = null;
}
if (currentSums !== `${sums}\n`) {
  drift = true;
  if (CHECK) console.error('difiere: CHECKSUMS.sha256');
  else writeFileSync(sumsPath, `${sums}\n`);
}

if (CHECK && drift) {
  console.error('El contrato generado no coincide: corre node contracts/atlas-integration-v1/build.mjs y commitea.');
  process.exit(1);
}
console.log(CHECK ? 'Contrato atlas-integration-v1 al día.' : 'Contrato atlas-integration-v1 escrito.');
