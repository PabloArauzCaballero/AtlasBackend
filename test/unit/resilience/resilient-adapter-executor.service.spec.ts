import { describe, expect, it, jest } from '@jest/globals';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';
import { AdapterError } from '../../../src/common/resilience/adapter-error.js';

describe('ResilientAdapterExecutorService', () => {
  it('runs the function successfully and reports the circuit as closed', async () => {
    const service = new ResilientAdapterExecutorService();
    const result = await service.run(async () => 'ok', { provider: 'sendgrid' });
    expect(result).toBe('ok');
    expect(service.circuitStateFor('sendgrid')).toBe('closed');
  });

  it('retries a retryable failure per the provided options before succeeding', async () => {
    const service = new ResilientAdapterExecutorService();
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw new AdapterError({ code: 'NETWORK', provider: 'twilio', message: 'blip', retryable: true });
      return 'ok';
    });

    const result = await service.run(fn, { provider: 'twilio', maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit for a provider after repeated failures, independent of other providers', async () => {
    const service = new ResilientAdapterExecutorService();
    const failing = () =>
      service.run(
        async () => {
          throw new AdapterError({ code: 'PROVIDER_ERROR', provider: 'infocenter', message: 'down', retryable: false });
        },
        { provider: 'infocenter', maxAttempts: 1 },
      );

    for (let i = 0; i < 5; i += 1) {
      await expect(failing()).rejects.toThrow();
    }

    expect(service.circuitStateFor('infocenter')).toBe('open');
    expect(service.circuitStateFor('segip')).toBe('never_used');
  });

  describe('métricas de negocio (Fase 3.4)', () => {
    function buildWithMetrics() {
      const metrics = { recordProviderCall: jest.fn(), setCircuitBreakerState: jest.fn() };
      const service = new ResilientAdapterExecutorService(metrics as never);
      return { service, metrics };
    }

    it('registra la llamada y el estado del breaker en una ejecución exitosa', async () => {
      const { service, metrics } = buildWithMetrics();
      await service.run(async () => 'ok', { provider: 'sendgrid' });

      expect(metrics.recordProviderCall).toHaveBeenCalledWith({ provider: 'sendgrid', outcome: 'success' });
      expect(metrics.setCircuitBreakerState).toHaveBeenCalledWith({ provider: 'sendgrid', state: 'closed' });
    });

    it('registra `failure` cuando el proveedor falla pero el breaker sigue cerrado', async () => {
      const { service, metrics } = buildWithMetrics();
      await expect(
        service.run(
          async () => {
            throw new AdapterError({ code: 'PROVIDER_ERROR', provider: 'twilio', message: 'down', retryable: false });
          },
          { provider: 'twilio', maxAttempts: 1 },
        ),
      ).rejects.toThrow();

      expect(metrics.recordProviderCall).toHaveBeenCalledWith({ provider: 'twilio', outcome: 'failure' });
    });

    it('una vez abierto el breaker, las llamadas cortadas se cuentan como `circuit_open` (sin costo)', async () => {
      const { service, metrics } = buildWithMetrics();
      const failing = () =>
        service.run(
          async () => {
            throw new AdapterError({ code: 'PROVIDER_ERROR', provider: 'infocenter', message: 'down', retryable: false });
          },
          { provider: 'infocenter', maxAttempts: 1 },
        );
      // 5 fallos consecutivos abren el breaker; la 6ª ya la corta el breaker antes de llamar.
      for (let i = 0; i < 6; i += 1) {
        await expect(failing()).rejects.toThrow();
      }

      expect(metrics.recordProviderCall).toHaveBeenCalledWith({ provider: 'infocenter', outcome: 'circuit_open' });
      expect(metrics.setCircuitBreakerState).toHaveBeenCalledWith({ provider: 'infocenter', state: 'open' });
    });

    it('sin MetricsService (construcción sin argumentos) sigue ejecutando igual', async () => {
      const service = new ResilientAdapterExecutorService();
      await expect(service.run(async () => 'ok', { provider: 'x' })).resolves.toBe('ok');
    });
  });
});
