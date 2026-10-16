import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { expectedHolderFrom } from '../../../src/modules/credit/application/statement-expected-holder.js';
import { rejectionCopyForRun, reviewCopyFor } from '../../../src/modules/credit/domain/statement-rejection.js';
import { BankStatementEngineClient } from '../../../src/modules/decision-engine/bank-statement-engine.client.js';

/**
 * El extracto tiene que ser de una cuenta del cliente que lo sube (Pablo, 2026-10-16): qué titular se exige, qué
 * viaja al motor y qué lee la persona cuando no coincide.
 */
describe('expectedHolderFrom · el titular que se exige', () => {
  it('con nombres y apellidos del perfil, los manda separados', () => {
    expect(expectedHolderFrom('Juan Carlos', 'Pérez Gómez')).toEqual({
      name: 'Juan Carlos Pérez Gómez',
      givenNames: 'Juan Carlos',
      surnames: 'Pérez Gómez',
    });
  });

  it('sin perfil, el nombre del carnet entero', () => {
    expect(expectedHolderFrom(null, null, 'PEREZ GOMEZ JUAN CARLOS')).toEqual({
      name: 'PEREZ GOMEZ JUAN CARLOS',
      givenNames: null,
      surnames: null,
    });
  });

  it('sin ningún nombre no exige titular (mejor que exigir uno inventado)', () => {
    expect(expectedHolderFrom(null, '  ', null)).toBeNull();
  });
});

describe('textos del titular', () => {
  it('no coincide: categoría propia, sin decir qué nombre se leyó', () => {
    const copia = rejectionCopyForRun('HOLDER_MISMATCH', 'HOLDER_MISMATCH');
    expect(copia.category).toBe('TITULAR_NO_COINCIDE');
    expect(copia.title).toMatch(/a tu nombre/);
    // Lo que la persona decidió en el motor también llega a la misma categoría.
    expect(rejectionCopyForRun(null, 'HOLDER_MISMATCH').category).toBe('TITULAR_NO_COINCIDE');
  });

  it('titular ilegible: en revisión, sin pedir nada', () => {
    expect(reviewCopyFor('HOLDER_UNREADABLE').message).toMatch(/nombre del titular/);
  });
});

describe('BankStatementEngineClient · el titular viaja con el PDF', () => {
  const original = new Map<string, unknown>();
  const poner = (valores: Record<string, unknown>) => {
    for (const [clave, valor] of Object.entries(valores)) {
      if (!original.has(clave)) original.set(clave, (env as Record<string, unknown>)[clave]);
      (env as Record<string, unknown>)[clave] = valor;
    }
  };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    poner({
      DECISION_ENGINE_BASE_URL: 'http://motor:4000',
      DECISION_ENGINE_STATEMENT_API_KEY: 'llave-extractos',
      DECISION_ENGINE_STATEMENT_MAX_WAIT_MS: 200,
      DECISION_ENGINE_STATEMENT_POLL_MS: 1,
      DECISION_ENGINE_STATEMENT_TIMEOUT_MS: 1000,
    });
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    for (const [clave, valor] of original) (env as Record<string, unknown>)[clave] = valor;
    original.clear();
  });

  const entrada = {
    fileName: 'extracto.pdf',
    bytes: Buffer.from('%PDF-1.4'),
    expectedHolder: { name: 'Juan Pérez', givenNames: 'Juan', surnames: 'Pérez' },
  };

  it('manda el nombre exigido en el formulario', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({ requestId: 'r1', status: 'SUCCEEDED', result: null }),
    }));
    await new BankStatementEngineClient().analyze(entrada);
    const form = (fetchMock.mock.calls[0] as unknown as [string, { body: FormData }])[1].body;
    expect(form.get('expectedHolderName')).toBe('Juan Pérez');
    expect(form.get('expectedHolderGivenNames')).toBe('Juan');
    expect(form.get('expectedHolderSurnames')).toBe('Pérez');
  });

  it('el PDF ya está en curso para otro titular: es un rechazo, no una avería', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ code: 'STATEMENT_HOLDER_CONFLICT' }),
    }));
    const desenlace = await new BankStatementEngineClient().analyze(entrada);
    expect(desenlace.kind).toBe('rejected');
    expect(desenlace.kind === 'rejected' && desenlace.run.errorCode).toBe('HOLDER_MISMATCH');
  });
});
