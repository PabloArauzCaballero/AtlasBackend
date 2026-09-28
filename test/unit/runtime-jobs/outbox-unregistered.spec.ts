import { describe, expect, it, jest } from '@jest/globals';
import { reportUnregisteredDomainEvents, tallyUnregisteredDomainEvents } from '../../../src/modules/runtime-jobs/outbox-unregistered.js';

/**
 * B12: `process_outbox` sigue marcando procesado lo no registrado, pero un evento de DOMINIO sin
 * registrar deja de desaparecer en silencio. La telemetría HTTP del interceptor, que es la población
 * para la que existe el job, no debe hacer ruido.
 */
describe('eventos de dominio sin registrar en process_outbox', () => {
  it('ignora la telemetría HTTP: familia api_audit o código sin punto (filas anteriores a la marca)', () => {
    expect(
      tallyUnregisteredDomainEvents([
        { id: '1', tenant_id: 't', event_code: 'post_x_completed', event_family: 'api_audit' },
        { id: '2', tenant_id: null, event_code: 'patch_y_completed', event_family: null },
        { id: '3', tenant_id: 't', event_code: null, event_family: null },
      ]),
    ).toEqual({});
  });

  it('cuenta por código lo que sí es dominio', () => {
    expect(
      tallyUnregisteredDomainEvents([
        { id: '1', tenant_id: 't', event_code: 'a.b', event_family: null },
        { id: '2', tenant_id: 't', event_code: 'a.b', event_family: 'domain' },
        { id: '3', tenant_id: 't', event_code: 'c.d', event_family: null },
      ]),
    ).toEqual({ 'a.b': 2, 'c.d': 1 });
  });

  it('un aviso y una muestra de métrica por código, no por fila', () => {
    const logger = { warn: jest.fn() };
    const metrics = { recordOutboxUnregisteredEvents: jest.fn() };
    reportUnregisteredDomainEvents(logger, metrics, 't1', { 'a.b': 2, 'c.d': 1 });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[0]![0]).toMatch(/^OUTBOX_UNREGISTERED_EVENT tenant=t1 code=a\.b count=2/);
    expect(metrics.recordOutboxUnregisteredEvents).toHaveBeenCalledWith({ eventCode: 'a.b', count: 2 });
    expect(metrics.recordOutboxUnregisteredEvents).toHaveBeenCalledWith({ eventCode: 'c.d', count: 1 });
  });

  it('sin métricas (pruebas, worker sin SDK) sigue avisando', () => {
    const logger = { warn: jest.fn() };
    reportUnregisteredDomainEvents(logger, undefined, 't1', { 'a.b': 1 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('sin nada que avisar, silencio', () => {
    const logger = { warn: jest.fn() };
    reportUnregisteredDomainEvents(logger, undefined, 't1', {});
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
