/**
 * @file La traza sobrevive al salto asíncrono: productor (API) → fila del outbox → consumidor (worker).
 * @business Un aviso, un crédito o un alta se pueden seguir de punta a punta aunque el trabajo se
 *   complete minutos después y en otro proceso; una fila escrita antes de existir esta propagación
 *   se sigue procesando igual.
 * @system Escritor y relay REALES contra PostgreSQL, con un exportador de spans en memoria. No se
 *   simula nada del camino que se quiere probar: el contexto se serializa a `metadata_json`, muere
 *   con el commit y se reconstruye al reclamar.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { SpanKind } from '@opentelemetry/api';
import { InboxReceiptModel, OutboxEventModel } from '../../../src/database/models/index.js';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import type { EventConsumer } from '../../../src/platform/events/event-consumer.port.js';
import { LocalConsumerDispatchPublisher } from '../../../src/platform/events/local-consumer-dispatch.publisher.js';
import { OutboxRelayService } from '../../../src/platform/events/outbox-relay.service.js';
import { SequelizeOutboxWriter } from '../../../src/platform/events/sequelize-outbox-writer.js';
import { TracingService } from '../../../src/common/observability/tracing.service.js';
import { installInMemoryTracing, type TracingHarness } from '../../unit/observability/support/in-memory-tracing.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let harness: TracingHarness;
const producer = `it-otel-${runToken()}`;
const tracing = new TracingService();

beforeAll(async () => {
  harness = installInMemoryTracing();
  database = await openIntegrationDatabase();
});
afterEach(() => harness.reset());
afterAll(async () => {
  if (database) {
    await InboxReceiptModel.destroy({ where: { producer } });
    await OutboxEventModel.destroy({ where: { producer } });
  }
  await database?.close();
  await harness.shutdown();
});

/** Un consumidor que sólo anota que recibió algo: lo que se mide es la traza, no el efecto. */
function consumidorTestigo(recibidos: string[]): EventConsumer {
  return {
    consumerId: `otel-consumer-${runToken()}`,
    subscriptions: { '*': [1] },
    handle: async (event) => {
      recibidos.push(event.eventId);
    },
  };
}

function relayCon(consumer: EventConsumer, sequelize: IntegrationDatabase['sequelize']): OutboxRelayService {
  return new OutboxRelayService(sequelize, [], new LocalConsumerDispatchPublisher(sequelize, new ConsumerRegistry([consumer])));
}

type Publicado = { eventId: string; outboxRowId: string; aggregateId: string };

async function publicar(database: IntegrationDatabase): Promise<Publicado> {
  const aggregateId = `otel-${runToken()}-${contador++}`;
  const resultado = await database.sequelize.transaction((transaction) =>
    new SequelizeOutboxWriter(OutboxEventModel, transaction).append({
      type: 'credit.application.submitted',
      scope: { kind: 'platform' },
      aggregate: { type: 'credit_application', id: aggregateId, version: 1 },
      producer,
      payload: {},
    }),
  );
  return { ...resultado, aggregateId };
}

let contador = 0;

/**
 * El span de despacho de UNA fila concreta.
 *
 * El relay reclama TODAS las filas pendientes, no sólo la de la prueba en curso —lo descubrió
 * esta misma suite—, así que buscar por nombre devolvía el span de otra. Se selecciona por
 * `app.entity.id`, que es exactamente el criterio con el que soporte busca una traza en Jaeger.
 */
function dispatchDe(harness: TracingHarness, aggregateId: string) {
  return harness.spans().find((span) => span.name === 'outbox.dispatch' && span.attributes['app.entity.id'] === aggregateId);
}

/** Vacía las filas que otras pruebas dejaron pendientes, para que el relay sólo traiga la nuestra. */
async function drenar(database: IntegrationDatabase): Promise<void> {
  await relayCon(consumidorTestigo([]), database.sequelize).run({ tenantId: null, limit: 200, workerId: 'drenaje' });
  harness.reset();
}

describe('continuidad de la traza a través del outbox', () => {
  it('productor y consumidor comparten trace_id con spans propios, en la relación correcta', async () => {
    if (!database) return;
    const recibidos: string[] = [];
    const consumer = consumidorTestigo(recibidos);

    // "Proceso 1": la API, dentro del span de una petición.
    const publicado = await tracing.runInSpan('peticion.simulada', {}, () => publicar(database!));

    // El contexto en memoria ya no existe: el relay sólo tiene la fila.
    await relayCon(consumer, database.sequelize).run({ tenantId: null, limit: 50, workerId: 'otel' });

    expect(recibidos).toContain(publicado.eventId);
    const peticion = harness.spanNamed('peticion.simulada')!;
    const productor = harness.spanNamed('outbox.publish')!;
    const consumidor = dispatchDe(harness, publicado.aggregateId)!;

    expect(productor.spanContext().traceId).toBe(peticion.spanContext().traceId);
    expect(consumidor.spanContext().traceId).toBe(peticion.spanContext().traceId);
    expect(consumidor.parentSpanContext?.spanId).toBe(productor.spanContext().spanId);
    expect(consumidor.spanContext().spanId).not.toBe(productor.spanContext().spanId);
    expect(productor.kind).toBe(SpanKind.PRODUCER);
    expect(consumidor.kind).toBe(SpanKind.CONSUMER);
    expect(consumidor.attributes['app.job.outcome']).toBe('published');
  });

  it('el portador se PERSISTE en metadata_json, fuera del payload del evento', async () => {
    if (!database) return;
    const publicado = await tracing.runInSpan('peticion.simulada', {}, () => publicar(database!));
    const fila = await OutboxEventModel.findOne({ where: { eventId: publicado.eventId } as never });

    const metadata = fila?.metadataJson as Record<string, Record<string, string>> | null;
    expect(metadata?.otel?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    expect(metadata?.otel?.traceparent).toContain(harness.spanNamed('peticion.simulada')!.spanContext().traceId);
    // El contrato de dominio no se altera para transportar trazabilidad.
    expect(fila?.eventPayloadJson).toEqual({});
  });

  it('una fila ANTIGUA sin portador se procesa igual y abre su propia traza', async () => {
    if (!database) return;
    await drenar(database);
    const recibidos: string[] = [];
    const consumer = consumidorTestigo(recibidos);
    const publicado = await publicar(database); // sin span activo: no hay portador que inyectar

    await OutboxEventModel.update({ metadataJson: null } as never, { where: { eventId: publicado.eventId } as never });
    harness.reset();

    await relayCon(consumer, database.sequelize).run({ tenantId: null, limit: 50, workerId: 'otel' });

    expect(recibidos).toContain(publicado.eventId);
    const consumidor = dispatchDe(harness, publicado.aggregateId)!;
    expect(consumidor.parentSpanContext).toBeUndefined();
    expect(consumidor.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('un portador manipulado no rompe el despacho', async () => {
    if (!database) return;
    await drenar(database);
    const recibidos: string[] = [];
    const consumer = consumidorTestigo(recibidos);
    const publicado = await publicar(database);

    await OutboxEventModel.update({ metadataJson: { otel: { traceparent: 'basura' } } } as never, {
      where: { eventId: publicado.eventId } as never,
    });
    harness.reset();

    await relayCon(consumer, database.sequelize).run({ tenantId: null, limit: 50, workerId: 'otel' });
    expect(recibidos).toContain(publicado.eventId);
    expect(dispatchDe(harness, publicado.aggregateId)).toBeDefined();
  });

  it('el span del productor NO lleva el payload del evento', async () => {
    if (!database) return;
    await tracing.runInSpan('peticion.simulada', {}, () => publicar(database!));
    const atributos = harness.spanNamed('outbox.publish')!.attributes;
    expect(Object.keys(atributos).sort()).toEqual([
      'app.entity.id',
      'app.entity.type',
      'app.event.type',
      'app.module',
      'messaging.destination.name',
      'messaging.operation.type',
      'messaging.system',
    ]);
  });
});
