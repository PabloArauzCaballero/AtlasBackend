/**
 * @file El contexto de una corrida QA sale sólo hacia el emulador, y nunca hacia un proveedor real.
 * @business Un contexto de pruebas que llega a un tercero es, en el mejor caso, ruido en los logs de
 *   ese tercero; y una corrida sin token no puede entrar en el namespace de otra.
 * @system `runContextHeaders`, función pura: el modo y "¿es runtime productivo?" llegan como datos.
 */
import { describe, expect, it } from '@jest/globals';
import { runContextHeaders, type QaRunContext } from '../../../src/modules/external-data/domain/qa-run-context.js';

const context: QaRunContext = {
  tenantId: 'tenant-1',
  runId: 'run-9',
  runToken: 'token-de-la-corrida',
  personaKey: 'p-42',
  logicalOperationId: 'verificar-identidad',
  attempt: 2,
  epoch: 'epoch-abc',
  schemaVersion: '2.0.0',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
};

const enMock = { mode: 'mock_server', productionRuntime: false };

describe('cabeceras del contexto de corrida QA', () => {
  it('en mock_server viaja el contexto completo', () => {
    const headers = runContextHeaders(context, enMock);
    expect(headers).toEqual({
      'x-mock-tenant-id': 'tenant-1',
      'x-mock-run-id': 'run-9',
      'x-mock-run-token': 'token-de-la-corrida',
      'x-mock-persona-key': 'p-42',
      'x-mock-logical-operation-id': 'verificar-identidad',
      'x-mock-attempt': '2',
      'x-mock-epoch': 'epoch-abc',
      'x-mock-schema-version': '2.0.0',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
  });

  it('sin contexto no hay cabeceras: el consumidor actual del backend no cambia', () => {
    expect(runContextHeaders(undefined, enMock)).toEqual({});
  });

  it.each(['production', 'sandbox', 'mock_local', 'disabled'])('el modo %s no recibe contexto de QA', (mode) => {
    expect(runContextHeaders(context, { mode, productionRuntime: false })).toEqual({});
  });

  it('en runtime productivo no viaja aunque el modo sea mock_server', () => {
    // Una configuración equivocada no puede convertirse en metadata de pruebas saliendo a
    // producción: se descarta aquí, no se confía en que nadie la configure mal.
    expect(runContextHeaders(context, { mode: 'mock_server', productionRuntime: true })).toEqual({});
  });

  it('sin runToken no viaja nada: nombrar una corrida no es entrar en ella', () => {
    expect(runContextHeaders({ ...context, runToken: '' }, enMock)).toEqual({});
  });

  it('sin tenantId o sin runId tampoco: una corrida se nombra con los dos', () => {
    expect(runContextHeaders({ ...context, tenantId: '  ' }, enMock)).toEqual({});
    expect(runContextHeaders({ ...context, runId: '' }, enMock)).toEqual({});
  });

  it('los campos opcionales ausentes no generan cabeceras vacías', () => {
    const headers = runContextHeaders({ tenantId: 't', runId: 'r', runToken: 'k' }, enMock);
    expect(Object.keys(headers).sort()).toEqual(['x-mock-run-id', 'x-mock-run-token', 'x-mock-tenant-id']);
  });

  it('un attempt no entero se descarta en vez de mandarse como NaN', () => {
    const headers = runContextHeaders({ ...context, attempt: 1.5 }, enMock);
    expect(headers['x-mock-attempt']).toBeUndefined();
  });

  it('las etiquetas se acotan: terminan en el journal y en el tablero del portal', () => {
    const headers = runContextHeaders({ ...context, personaKey: 'p'.repeat(500) }, enMock);
    expect(headers['x-mock-persona-key']).toHaveLength(120);
  });

  it('nunca incluye Authorization: el emulador no debe ver tokens de sesión', () => {
    const headers = runContextHeaders(context, enMock);
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('authorization');
  });
});
