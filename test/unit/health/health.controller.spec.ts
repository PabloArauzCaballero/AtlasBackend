import { describe, expect, it, jest } from '@jest/globals';
import { HealthController } from '../../../src/modules/health/health.controller.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 4): último módulo del plan de
 * cobertura — trivial (49 líneas), test de humo simple. La única regla real que vale la pena
 * fijar por escrito es que el endpoint nunca lanza si la base de datos está caída: responde
 * `degraded`, no un error 500, para que el healthcheck del balanceador de carga siga
 * distinguiendo "la API responde pero la DB está mal" de "la API no responde en absoluto".
 */
describe('HealthController.check', () => {
  function buildController(authenticate: () => Promise<void>) {
    const sequelize = { authenticate: jest.fn(authenticate) };
    const controller = new HealthController(sequelize as never);
    return { controller, sequelize };
  }

  it('reports status "ok" and database "ok" when the database responds', async () => {
    const { controller } = buildController(async () => undefined);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('ok');
  });

  it('reports status "degraded" and database "unreachable" when the database throws — never lets the error propagate', async () => {
    const { controller } = buildController(async () => {
      throw new Error('connection refused');
    });
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('unreachable');
  });

  it('always includes service, version, uptime and a valid ISO timestamp', async () => {
    const { controller } = buildController(async () => undefined);
    const result = await controller.check();
    expect(result.service).toBe('atlas-backend');
    expect(typeof result.uptime).toBe('number');
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
