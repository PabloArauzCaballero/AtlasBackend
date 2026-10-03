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
