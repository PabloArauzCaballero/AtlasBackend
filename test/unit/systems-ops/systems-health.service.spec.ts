import { describe, expect, it, jest } from '@jest/globals';
import { SystemsHealthService } from '../../../src/modules/systems-ops/systems-health.service.js';

/**
 * `SystemsHealthService.getToolsHealth` combina el catálogo de herramientas con un probe en vivo:
 * PostgreSQL (authenticate), Redis (ping) o, para el resto, una verificación de configuración por
 * variables de entorno requeridas. Spec directo con repo/sequelize/redis mockeados.
 */
describe('SystemsHealthService', () => {
  function build(rows: unknown[], redis: unknown = { ping: jest.fn(async () => 'PONG') }) {
    const repository = { listTools: jest.fn(async () => ({ rows })) };
    const sequelize = { authenticate: jest.fn(async () => undefined) };
    const service = new SystemsHealthService(repository as never, sequelize as never, redis as never);
    return { service, repository, sequelize, redis };
  }

  const tool = (over: Record<string, unknown>) => ({
    id: 1,
    code: 'X',
    name: 'X',
    requiredEnvVars: [] as string[],
    isCritical: false,
    isWorker: false,
    status: 'active',
    ...over,
  });

  it('POSTGRES: sano cuando authenticate resuelve', async () => {
    const { service, sequelize } = build([tool({ code: 'POSTGRES' })]);
    const [res] = await service.getToolsHealth();
    expect(sequelize.authenticate).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ code: 'POSTGRES', checkType: 'LIVE', isHealthy: true, isConfigured: true });
  });

  it('POSTGRES: no sano y con el mensaje del error si authenticate lanza', async () => {
    const { service, sequelize } = build([tool({ code: 'POSTGRES' })]);
    (sequelize.authenticate as jest.Mock).mockRejectedValueOnce(new Error('db caída') as never);
    const [res] = await service.getToolsHealth();
    expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: false, healthMessage: 'db caída' });
  });

  it('REDIS: no sano si no hay cliente configurado', async () => {
    const { service } = build([tool({ code: 'REDIS' })], null);
    const [res] = await service.getToolsHealth();
    expect(res).toMatchObject({ isHealthy: false, healthMessage: 'Cliente Redis no configurado.' });
  });

  it('REDIS: sano cuando responde PONG', async () => {
    const redis = { ping: jest.fn(async () => 'PONG') };
    const { service } = build([tool({ code: 'REDIS' })], redis);
    const [res] = await service.getToolsHealth();
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ isHealthy: true, healthMessage: 'Redis respondió PONG.' });
  });

  it('otra herramienta configurada => CONFIGURATION sin probe (isHealthy null)', async () => {
    const { service } = build([tool({ code: 'STRIPE', requiredEnvVars: [] })]);
    const [res] = await service.getToolsHealth();
    expect(res).toMatchObject({ checkType: 'CONFIGURATION', isConfigured: true, isHealthy: null });
  });

  it('otra herramienta con variable de entorno faltante => no configurada y CONFIGURATION no sana', async () => {
    const { service } = build([tool({ code: 'STRIPE', requiredEnvVars: ['ATLAS_FAKE_ENV_VAR_XYZ'] })]);
    const [res] = await service.getToolsHealth();
    expect(res.missingEnvVars).toContain('ATLAS_FAKE_ENV_VAR_XYZ');
    expect(res).toMatchObject({ isConfigured: false, checkType: 'CONFIGURATION', isHealthy: false });
  });
});
