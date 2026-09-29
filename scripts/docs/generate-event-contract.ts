/**
 * @file Genera el catálogo de eventos (`docs/events/event-catalog.md`) y el contrato AsyncAPI desde el código.
 * @business Un consumidor sólo puede contar con los eventos que algún código publica; el resto es reserva.
 * @system `yarn docs:events` escribe; `yarn check:events-docs` (CI) falla si lo versionado difiere.
 *
 * Antes ambos se escribían a mano: el catálogo listaba 8 de 12 familias, la visión general contaba «89
 * eventos en 9 familias» y el AsyncAPI publicaba nueve mensajes de los que sólo uno (`kyc.approved`)
 * emitía algún código, mientras omitía familias que sí se emiten (pagos, admisión de crédito, ciclo de
 * vida del cliente, soporte). Aquí el registro es `EVENT_REGISTRY` y «emitido» se calcula
 * (`lib/event-inventory.ts`). El AsyncAPI declara SÓLO lo emitido; lo reservado queda en el catálogo.
 */
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { familiesOf, loadEventInventory, NON_PRODUCER_PATHS, type EventInventoryItem } from './lib/event-inventory.js';
import { writeOrCheck } from './lib/generated-file.js';

const CATALOG = 'docs/events/event-catalog.md';
const ASYNCAPI = 'asyncapi/asyncapi.yaml';
const OUTBOX_MODEL = 'src/database/models/outbox-events.model.ts';

/**
 * La fila de `outbox_events` tal y como la persiste el modelo. El generador comprueba que cada columna
 * existe en `outbox-events.model.ts`: un campo renombrado rompe el gate en vez de dejar el contrato
 * describiendo una columna que ya no está.
 */
const ENVELOPE: Array<{ column: string; schema: Record<string, unknown>; description: string; required?: boolean }> = [
  { column: 'event_id', schema: { type: 'string', format: 'uuid' }, description: 'Identificador único del evento.', required: true },
  { column: 'event_code', schema: { type: 'string' }, description: 'Código del registro (`EVENT_REGISTRY`).', required: true },
  { column: 'event_family', schema: { type: ['string', 'null'] }, description: 'Familia del registro.' },
  { column: 'event_version', schema: { type: ['integer', 'null'] }, description: 'Versión del código en el registro.' },
  { column: 'schema_version', schema: { type: 'integer' }, description: 'Versión del esquema del payload.', required: true },
  { column: 'aggregate_type', schema: { type: 'string' }, description: 'Tipo de la entidad afectada.', required: true },
  { column: 'aggregate_id', schema: { type: ['string', 'null'] }, description: 'Identificador de la entidad afectada.' },
  {
    column: 'aggregate_version',
    schema: { type: ['string', 'null'] },
    description: 'Versión monótona del agregado (P-08): un consumidor que ya aplicó la N descarta la N-1 que llegue tarde.',
  },
  { column: '_tenant_id', schema: { type: ['string', 'null'] }, description: 'Tenant. `null` en eventos de plataforma.' },
  { column: 'event_payload_json', schema: { type: ['object', 'null'] }, description: 'Carga del evento. Sin PII en claro.' },
  { column: 'metadata_json', schema: { type: ['object', 'null'] }, description: 'Metadatos de origen.' },
  { column: 'correlation_id', schema: { type: ['string', 'null'] }, description: 'Enlaza el evento con la petición que lo originó.' },
  { column: 'causation_id', schema: { type: ['string', 'null'] }, description: 'Evento que causó éste.' },
  { column: 'idempotency_key', schema: { type: ['string', 'null'] }, description: 'Clave de deduplicación del productor.' },
  { column: 'producer', schema: { type: ['string', 'null'] }, description: 'Contexto que escribió el evento.' },
  { column: 'priority', schema: { type: ['integer', 'null'] }, description: 'Menor valor = se despacha antes dentro del lote.' },
  {
    column: 'status',
    schema: { type: 'string', enum: ['pending', 'processing', 'processed', 'failed', 'cancelled'] },
    description: 'Estado.',
    required: true,
  },
  { column: '_created_at', schema: { type: 'string', format: 'date-time' }, description: 'Momento en que se escribió.', required: true },
];

function assertEnvelopeMatchesModel(): void {
  const model = readFileSync(OUTBOX_MODEL, 'utf8');
  const missing = ENVELOPE.filter((field) => !model.includes(`field: '${field.column}'`)).map((field) => field.column);
  if (missing.length === 0) return;
  console.error(`❌ El sobre del contrato nombra columnas que ${OUTBOX_MODEL} no declara: ${missing.join(', ')}`);
  process.exit(1);
}

const camel = (text: string): string => text.replace(/[._]([a-z])/g, (_, letter: string) => letter.toUpperCase());
const pascal = (text: string): string => camel(text).replace(/^[a-z]/, (letter) => letter.toUpperCase());

function notificationText(item: EventInventoryItem): string {
  if (item.notifications.length === 0) return '—';
  return item.notifications.map((rule) => `${rule.recipientType}: ${rule.channels.join(', ')}`).join('; ');
}

function catalogMarkdown(items: readonly EventInventoryItem[]): string {
  const emitted = items.filter((item) => item.emitted);
  const lines = [
    '# Catálogo de eventos de dominio',
    '',
    '> **Generado.** No se edita a mano: `yarn docs:events` lo escribe desde `EVENT_REGISTRY`',
    '> (`src/modules/events/event-registry.ts`) y desde los productores reales de `src/`; `yarn check:events-docs`',
    '> (CI) falla si difiere. Fuente: `scripts/docs/generate-event-contract.ts`.',
    '',
    `**${items.length} códigos registrados en ${familiesOf(items).length} familias. ${emitted.length} tienen productor en el código;`,
    `los ${items.length - emitted.length} restantes están reservados**: registrarlos permite publicarlos sin cambiar el contrato, pero`,
    'hoy ningún código los escribe y un consumidor no debe esperarlos. El contrato AsyncAPI',
    '(`asyncapi/asyncapi.yaml`) declara sólo los emitidos.',
    '',
    '`EventsService.publish` rechaza un código fuera del registro (`EVENT_NOT_REGISTERED`), pero los productores que',
    'escriben el outbox directamente (`SequelizeOutboxWriter`, repositorios) no pasan por ahí: si uno usa un código sin',
    'registrar, `process_outbox` lo marca procesado sin consumirlo y deja el aviso `OUTBOX_UNREGISTERED_EVENT`',
    '(`src/modules/runtime-jobs/outbox-unregistered.ts`).',
    '',
    '## Cómo se calcula «emitido»',
    '',
    'Un código cuenta como emitido si su literal aparece en código de producción de `src/` (sin pruebas), o si un',
    'productor escribe una plantilla con su prefijo (``eventCode: `customer.lifecycle.${…}` ``). No cuentan los',
    'archivos que sólo lo nombran:',
    '',
    ...NON_PRODUCER_PATHS.map((entry) => `- \`${entry.path}\` — ${entry.why}.`),
    '',
    '**Aviso** es lo que genera `NotificationRulesService` al consumir el evento (destinatario: canales); `—` significa',
    'que `process_events` lo consume sin generar mensaje.',
    '',
  ];
  for (const family of familiesOf(items)) {
    const own = items.filter((item) => item.family === family);
    const first = own[0];
    lines.push(
      `## \`${family}\``,
      '',
      `Agregados admitidos: ${first.allowedAggregateTypes.map((type) => `\`${type}\``).join(', ')} · prioridad por defecto: ${first.defaultPriority} · emitidos: ${own.filter((item) => item.emitted).length} de ${own.length}.`,
      '',
      '| Código | Emitido | Productor | Aviso |',
      '|---|---|---|---|',
      ...own.map(
        (item) =>
          `| \`${item.code}\` | ${item.emitted ? 'sí' : 'no (reservado)'} | ${item.producers.map((file) => `\`${file}\``).join('<br>') || '—'} | ${notificationText(item)} |`,
      ),
      '',
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function asyncApiDocument(items: readonly EventInventoryItem[]): Record<string, unknown> {
  const emitted = items.filter((item) => item.emitted);
  const families = familiesOf(emitted);
  const envelopeProperties = Object.fromEntries(
    ENVELOPE.map((field) => [field.column, { ...field.schema, description: field.description }]),
  );
  const messages = Object.fromEntries(
    emitted.map((item) => [
      pascal(item.code),
      {
        name: item.code,
        title: item.code,
        summary: `Familia ${item.family}. Productor: ${item.producers.join(', ')}.`,
        contentType: 'application/json',
        payload: { $ref: '#/components/schemas/OutboxEvent' },
      },
    ]),
  );
  const channels = Object.fromEntries(
    families.map((family) => [
      camel(family),
      {
        address: `outbox_events/${family}`,
        description: `Eventos emitidos de la familia \`${family}\`.`,
        messages: Object.fromEntries(
          emitted
            .filter((item) => item.family === family)
            .map((item) => [camel(item.code), { $ref: `#/components/messages/${pascal(item.code)}` }]),
        ),
      },
    ]),
  );
  const operations = Object.fromEntries(
    families.map((family) => [
      `receive${pascal(family)}`,
      { action: 'receive', channel: { $ref: `#/channels/${camel(family)}` }, summary: `Consumir los eventos emitidos de \`${family}\`.` },
    ]),
  );
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'Atlas Backend · Eventos de dominio',
      version: '0.3.0',
      description: [
        'Eventos de dominio que Atlas ESCRIBE hoy en el outbox transaccional (`outbox_events`, PostgreSQL).',
        '',
        '**Generado** por `yarn docs:events` desde `EVENT_REGISTRY` y los productores reales de `src/`; no se edita a mano.',
        `Declara sólo los ${emitted.length} códigos con productor de los ${items.length} registrados: los reservados`,
        'están en `docs/events/event-catalog.md` y un consumidor no debe esperarlos.',
        '',
        '**Garantía de entrega: at-least-once.** Un consumidor DEBE ser idempotente. El orden no está garantizado',
        'entre agregados distintos; usar `aggregate_version` para descartar versiones viejas.',
        '',
        'El payload (`event_payload_json`) no tiene esquema publicado por código: su forma la fija cada productor,',
        'citado en el resumen de cada mensaje.',
      ].join('\n'),
      license: { name: 'UNLICENSED' },
    },
    defaultContentType: 'application/json',
    servers: {
      outbox: {
        host: 'postgresql',
        protocol: 'postgres',
        description:
          'Tabla `outbox_events`. No hay endpoint de suscripción: se declara como servidor para que el contrato diga dónde vive la fuente de verdad.',
      },
    },
    channels,
    operations,
    components: {
      schemas: {
        OutboxEvent: {
          type: 'object',
          description: 'Fila de `outbox_events` (columnas comprobadas contra `src/database/models/outbox-events.model.ts`).',
          required: ENVELOPE.filter((field) => field.required).map((field) => field.column),
          properties: envelopeProperties,
        },
      },
      messages,
    },
  };
}

function main(): void {
  assertEnvelopeMatchesModel();
  const items = loadEventInventory();
  const header = [
    '# Contrato de los eventos de dominio de Atlas.',
    '#',
    '# GENERADO por `yarn docs:events` (scripts/docs/generate-event-contract.ts). No se edita a mano:',
    '# `yarn check:events-docs` falla en CI si difiere del código. Ver docs/events/overview.md y ADR-0001.',
    '',
  ].join('\n');
  writeOrCheck(
    [
      { path: CATALOG, content: catalogMarkdown(items) },
      { path: ASYNCAPI, content: `${header}${yaml.dump(asyncApiDocument(items), { noRefs: true, lineWidth: 120 })}` },
    ],
    'yarn docs:events',
  );
}

main();
