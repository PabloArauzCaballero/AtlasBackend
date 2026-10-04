import { describe, expect, it } from '@jest/globals';
import { dataSubjectRequestSchema } from '../../../src/modules/customer-privacy/customer-privacy.schemas.js';
import { DATA_SUBJECT_REQUEST_TYPES } from '../../../src/modules/customer-privacy/data-subject-request.state.js';

/**
 * Lo que Atlas ofrece desde la app: corregir un dato y borrar la cuenta. Nada más.
 *
 * Llevarse los datos, limitar el uso y retirar consentimientos son decisiones de producto que no se
 * ofrecen (2026-10-02); «ver mis datos» es una pantalla tras volver a pedir el PIN, no una solicitud.
 */
describe('dataSubjectRequestSchema', () => {
  it.each(['rectification', 'deletion'])('acepta «%s»', (requestType) => {
    expect(dataSubjectRequestSchema.safeParse({ requestType }).success).toBe(true);
  });

  it.each(['portability', 'restriction', 'revocation', 'access', 'erasure', 'objection'])('rechaza «%s»', (requestType) => {
    expect(dataSubjectRequestSchema.safeParse({ requestType }).success).toBe(false);
  });

  it('lo histórico sigue en el vocabulario de la cola de operaciones: hay filas que ya existen', () => {
    for (const historico of ['access', 'portability', 'restriction', 'revocation']) {
      expect(DATA_SUBJECT_REQUEST_TYPES).toContain(historico);
    }
  });

  it('la descripción sigue siendo opcional y acotada', () => {
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'deletion', description: 'hola' }).success).toBe(false);
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'deletion', description: 'quiero cerrar mi cuenta' }).success).toBe(true);
  });
});

/**
 * Una corrección tiene que decir QUÉ corregir y el valor correcto: sin eso no la puede decidir ni una persona ni el Motor.
 * Pero las versiones de la app que sólo mandan el texto siguen funcionando (esas las mira una persona).
 */
describe('dataSubjectRequestSchema · contenido de la solicitud', () => {
  it('una corrección con campo y valor es válida', () => {
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'rectification', field: 'zone', proposedValue: 'Equipetrol' }).success).toBe(
      true,
    );
  });

  it('compatibilidad: una corrección sólo con texto (app vieja) sigue siendo válida', () => {
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'rectification', description: 'mi zona está mal escrita' }).success).toBe(
      true,
    );
  });

  it('un campo sin valor no vale, salvo «other» con texto', () => {
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'rectification', field: 'city' }).success).toBe(false);
    expect(
      dataSubjectRequestSchema.safeParse({ requestType: 'rectification', field: 'other', description: 'mi profesión cambió' }).success,
    ).toBe(true);
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'rectification', field: 'other' }).success).toBe(false);
  });

  it('un valor sin campo no vale: no se sabría dónde ponerlo', () => {
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'rectification', proposedValue: 'Equipetrol' }).success).toBe(false);
  });

  it('un borrado no lleva campo ni valor', () => {
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'deletion', field: 'zone', proposedValue: 'x' }).success).toBe(false);
    expect(dataSubjectRequestSchema.safeParse({ requestType: 'deletion', description: 'quiero cerrar mi cuenta' }).success).toBe(true);
  });

  it('un campo fuera del vocabulario se rechaza', () => {
    expect(
      dataSubjectRequestSchema.safeParse({ requestType: 'rectification', field: 'credit_limit', proposedValue: '99999' }).success,
    ).toBe(false);
  });

  it('el valor propuesto está acotado a 300 caracteres', () => {
    expect(
      dataSubjectRequestSchema.safeParse({ requestType: 'rectification', field: 'address', proposedValue: 'x'.repeat(301) }).success,
    ).toBe(false);
  });
});
