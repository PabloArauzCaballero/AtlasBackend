import { describe, expect, it } from '@jest/globals';
import { outboxConsumerAttributes, outboxProducerAttributes } from '../../../src/common/observability/messaging-attributes.js';

const evento = { eventType: 'credit.application.submitted', aggregateType: 'credit_application' };

describe('atributos de mensajería del outbox', () => {
  it('productor y consumidor comparten sistema y destino, y sólo difieren en la operación', () => {
    const productor = outboxProducerAttributes(evento);
    const consumidor = outboxConsumerAttributes(evento);
    expect(productor['messaging.system']).toBe(consumidor['messaging.system']);
    expect(productor['messaging.destination.name']).toBe(consumidor['messaging.destination.name']);
    expect(productor['messaging.operation.type']).toBe('send');
    expect(consumidor['messaging.operation.type']).toBe('process');
  });

  it('el consumidor publica el número de intento', () => {
    expect(outboxConsumerAttributes({ ...evento, attempt: 3 })['app.job.attempt']).toBe(3);
  });

  it('publica el agregado cuando lo hay: es como soporte encuentra la traza de un caso', () => {
    expect(outboxProducerAttributes({ ...evento, aggregateId: 'CRA-1' })['app.entity.id']).toBe('CRA-1');
  });

  it('un agregado nulo se omite en vez de publicarse como cadena vacía', () => {
    expect(Object.keys(outboxProducerAttributes({ ...evento, aggregateId: null }))).not.toContain('app.entity.id');
  });

  it('las claves opcionales se OMITEN en vez de declararse indefinidas', () => {
    expect(Object.keys(outboxConsumerAttributes(evento))).not.toContain('app.job.attempt');
    expect(Object.keys(outboxProducerAttributes(evento))).not.toContain('app.module');
  });

  it('un intento cero se publica: distingue «primer intento» de «no se sabe»', () => {
    expect(outboxConsumerAttributes({ ...evento, attempt: 0 })['app.job.attempt']).toBe(0);
  });

  it('nada de lo publicado describe el CONTENIDO del evento', () => {
    // Se comprueba el CONJUNTO de claves, no su orden: lo que importa es que no aparezca
    // ninguna que pudiera transportar el payload, el destinatario o un identificador de persona.
    const permitidas = new Set([
      'messaging.system',
      'messaging.destination.name',
      'messaging.operation.type',
      'app.event.type',
      'app.entity.id',
      'app.entity.type',
      'app.module',
      'app.job.attempt',
    ]);
    const claves = [
      ...Object.keys(outboxProducerAttributes({ ...evento, producer: 'credit' })),
      ...Object.keys(outboxConsumerAttributes({ ...evento, attempt: 1 })),
    ];
    expect(claves.filter((clave) => !permitidas.has(clave))).toEqual([]);
  });
});
