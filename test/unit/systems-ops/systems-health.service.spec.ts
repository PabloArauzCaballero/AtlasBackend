import { describe, expect, it, jest } from '@jest/globals';
import { SystemsHealthService } from '../../../src/modules/systems-ops/systems-health.service.js';

/**
 * `SystemsHealthService.getToolsHealth` combina el catálogo de herramientas con un probe en vivo:
 * PostgreSQL (authenticate), Redis (ping) o, para el resto, una verificación de configuración por
 * variables de entorno requeridas. Spec directo con repo/sequelize/redis mockeados.
 */
describe('SystemsHealthService', () => {
  function build(rows: unknown[], redis: unknown = { ping: jest.fn(async (..._args: unknown[]) => 'PONG') }) {
    const repository = { listTools: jest.fn(async (..._args: unknown[]) => ({ rows })) };
    const sequelize = {
      authenticate: jest.fn(async (..._args: unknown[]) => undefined),
      query: jest.fn(async (..._args: unknown[]) => []),
      models: { UserModel: {}, OutboxEventModel: {} },
    };
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
    const redis = { ping: jest.fn(async (..._args: unknown[]) => 'PONG') };
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

  it('herramienta PLANNED con variables faltantes => NOT_APPLICABLE (gris), NO cuenta como caída', async () => {
    const { service } = build([tool({ code: 'SEGIP_CGIP', status: 'PLANNED', requiredEnvVars: ['ATLAS_FAKE_ENV_VAR_XYZ'] })]);
    const [res] = await service.getToolsHealth();
    expect(res).toMatchObject({ isConfigured: false, checkType: 'NOT_APPLICABLE', isHealthy: null });
    expect(res.healthMessage).toContain('planificada');
  });

  it('herramienta PLANNED aunque tenga variables presentes => NOT_APPLICABLE (no hay integración que probar)', async () => {
    const { service } = build([tool({ code: 'BULLMQ', status: 'PLANNED', requiredEnvVars: [] })]);
    const [res] = await service.getToolsHealth();
    expect(res).toMatchObject({ checkType: 'NOT_APPLICABLE', isHealthy: null });
  });

  it('JEST y SMOKE_SCRIPTS => NOT_APPLICABLE con explicación honesta (tooling de desarrollo)', async () => {
    const { service } = build([tool({ code: 'JEST' }), tool({ code: 'SMOKE_SCRIPTS' })]);
    const [jest_, smoke] = await service.getToolsHealth();
    expect(jest_).toMatchObject({ checkType: 'NOT_APPLICABLE', isHealthy: null });
    expect(jest_.healthMessage).toContain('desarrollo');
    expect(smoke).toMatchObject({ checkType: 'NOT_APPLICABLE', isHealthy: null });
  });

  it('OPENAPI_SWAGGER => LIVE sano: se sirve con el propio backend', async () => {
    const { service } = build([tool({ code: 'OPENAPI_SWAGGER' })]);
    const [res] = await service.getToolsHealth();
    expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: true });
  });

  it('herramienta ACTIVA con variables faltantes sigue reportándose como no sana (false)', async () => {
    const { service } = build([tool({ code: 'STRIPE', status: 'ACTIVE', requiredEnvVars: ['ATLAS_FAKE_ENV_VAR_XYZ'] })]);
    const [res] = await service.getToolsHealth();
    expect(res).toMatchObject({ isConfigured: false, checkType: 'CONFIGURATION', isHealthy: false });
  });

  describe('probes en vivo para herramientas antes sin probe activo', () => {
    it('SEQUELIZE: sano cuando authenticate resuelve, reporta modelos registrados', async () => {
      const { service } = build([tool({ code: 'SEQUELIZE' })]);
      const [res] = await service.getToolsHealth();
      expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: true });
      expect(res.healthMessage).toContain('2 modelos');
    });

    it('JWT: firma y verifica un token real con el secreto configurado', async () => {
      const { service } = build([tool({ code: 'JWT' })]);
      const [res] = await service.getToolsHealth();
      expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: true });
    });

    it('ARGON2: hace un roundtrip real de hash+verify', async () => {
      const { service } = build([tool({ code: 'ARGON2' })]);
      const [res] = await service.getToolsHealth();
      expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: true });
    });

    it('ZOD: valida un schema trivial', async () => {
      const { service } = build([tool({ code: 'ZOD' })]);
      const [res] = await service.getToolsHealth();
      expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: true });
    });

    it.each(['OUTBOX_EVENTS_DB', 'IDEMPOTENCY_KEYS_DB', 'OPERATIONAL_AUDIT_LOGS', 'SYSTEM_ACTION_LOGS'])(
      '%s: sano cuando el SELECT 1 sobre su tabla resuelve',
      async (code) => {
        const { service, sequelize } = build([tool({ code })]);
        const [res] = await service.getToolsHealth();
        expect(sequelize.query).toHaveBeenCalledTimes(1);
        expect((sequelize.query as jest.Mock).mock.calls[0][0]).toContain('SELECT 1 FROM');
        expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: true });
      },
    );

    it('OUTBOX_EVENTS_DB: no sano con el mensaje del error si la tabla no responde', async () => {
      const { service, sequelize } = build([tool({ code: 'OUTBOX_EVENTS_DB' })]);
      (sequelize.query as jest.Mock).mockRejectedValueOnce(new Error('relation does not exist') as never);
      const [res] = await service.getToolsHealth();
      expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: false, healthMessage: 'relation does not exist' });
    });

    it('ARCHIVO_LOG_MONGO_SYNC: usa el ping a MongoDB (stubbeado) y reporta LIVE', async () => {
      const { service } = build([tool({ code: 'ARCHIVO_LOG_MONGO_SYNC' })]);
      const mongoPing = jest.fn(async (..._args: unknown[]) => ({
        checkType: 'LIVE' as const,
        isHealthy: true,
        healthMessage: 'MongoDB respondió al ping.',
      }));
      (service as unknown as { mongoPing: typeof mongoPing }).mongoPing = mongoPing;
      const [res] = await service.getToolsHealth();
      expect(mongoPing).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ checkType: 'LIVE', isHealthy: true });
    });

    it('onModuleDestroy no falla sin cliente Mongo creado', async () => {
      const { service } = build([]);
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
