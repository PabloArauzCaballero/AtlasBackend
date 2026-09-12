/**
 * @file AT-057 — el worker de Mensajería arranca solo, con su identidad de base, sin Crédito ni Clientes.
 * @business El piloto no puede leer las tablas de Crédito o Clientes aunque quiera (PostgreSQL lo deniega),
 *   no importa los módulos del monolito, y si su propia base no responde no arranca: readiness no miente.
 * @system Raíz real `MessagingWorkerModule` compuesta con `Test.createTestingModule` y la identidad
 *   `atlas_ctx_messaging` (ATLAS_TEST_CTX_PASSWORD). Las variables se fijan ANTES de importar `env`,
 *   por eso todas las importaciones que tocan configuración son dinámicas.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import 'reflect-metadata';

let moduleRef: TestingModule | null = null;
let skipped = false;
type Loaded = {
  MessagingWorkerModule: (typeof import('../../../src/bootstrap/messaging-worker.module.js'))['MessagingWorkerModule'];
  MESSAGING_FORBIDDEN_MODULES: readonly string[];
  MessagingRelayLoopService: (typeof import('../../../src/bootstrap/messaging-relay-loop.service.js'))['MessagingRelayLoopService'];
};
let loaded: Loaded;

beforeAll(async () => {
  const password = process.env.ATLAS_TEST_CTX_PASSWORD;
  if (!password) {
    if (process.env.ATLAS_GATES_ALLOW_SKIP === 'true') {
      skipped = true;
      return;
    }
    throw new Error('AT-057: falta ATLAS_TEST_CTX_PASSWORD (contraseña de ops/postgres/context-roles.sql).');
  }
  process.env.MESSAGING_DB_USER = 'atlas_ctx_messaging';
  process.env.MESSAGING_DB_PASSWORD = password;
  const { requireIsolatedDatabase } = await import('../../support/isolated-database.guard.js');
  requireIsolatedDatabase();
  const root = await import('../../../src/bootstrap/messaging-worker.module.js');
  const loop = await import('../../../src/bootstrap/messaging-relay-loop.service.js');
  loaded = {
    MessagingWorkerModule: root.MessagingWorkerModule,
    MESSAGING_FORBIDDEN_MODULES: root.MESSAGING_FORBIDDEN_MODULES,
    MessagingRelayLoopService: loop.MessagingRelayLoopService,
  };
  const { Test } = await import('@nestjs/testing');
  moduleRef = await Test.createTestingModule({ imports: [loaded.MessagingWorkerModule] }).compile();
  await moduleRef.init();
});

afterAll(async () => {
  await moduleRef?.close();
});

function importNames(module: unknown): string[] {
  const list = (Reflect.getMetadata('imports', module as object) ?? []) as unknown[];
  return list.map((entry) =>
    typeof entry === 'function' ? entry.name : ((entry as { module?: { name: string } }).module?.name ?? 'dynamic'),
  );
}

describe('AT-057 · worker de Mensajería independiente', () => {
  it('la raíz no monta controladores ni importa los módulos del monolito', () => {
    if (skipped) return;
    expect(Reflect.getMetadata('controllers', loaded.MessagingWorkerModule) ?? []).toEqual([]);
    const names = importNames(loaded.MessagingWorkerModule);
    for (const forbidden of loaded.MESSAGING_FORBIDDEN_MODULES) expect(names).not.toContain(forbidden);
  });

  it('arranca con su identidad: lee Mensajería y el outbox; Crédito y Clientes están denegados por PostgreSQL', async () => {
    if (skipped || !moduleRef) return;
    const { getConnectionToken } = await import('@nestjs/sequelize');
    const { QueryTypes } = await import('sequelize');
    const sequelize = moduleRef.get<import('sequelize-typescript').Sequelize>(getConnectionToken());
    const who = await sequelize.query<{ u: string }>('SELECT current_user AS u', { type: QueryTypes.SELECT });
    expect(who[0].u).toBe('atlas_ctx_messaging');
    await expect(
      sequelize.query('SELECT count(*) FROM messaging.notification_messages', { type: QueryTypes.SELECT }),
    ).resolves.toBeDefined();
    await expect(sequelize.query('SELECT count(*) FROM platform_ops.outbox_events', { type: QueryTypes.SELECT })).resolves.toBeDefined();
    await expect(sequelize.query('SELECT count(*) FROM credit.credit_applications', { type: QueryTypes.SELECT })).rejects.toThrow(
      /permission denied/,
    );
    await expect(sequelize.query('SELECT count(*) FROM customer.customer_contact_methods', { type: QueryTypes.SELECT })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('mientras el monolito sea el dueño, el bucle del relay late CERCADO: no reclama nada', async () => {
    if (skipped || !moduleRef) return;
    const loop = moduleRef.get(loaded.MessagingRelayLoopService);
    const result = await loop.tick();
    expect(result).not.toBeNull();
    expect(result!.fenced).toBe(true);
    expect(result!.claimed).toBe(0);
  });

  it('el consumidor de Mensajería está registrado y el directorio de destinatarios es el remoto (hueco declarado)', async () => {
    if (skipped || !moduleRef) return;
    const { EVENT_CONSUMERS } = await import('../../../src/platform/events/event-consumer.port.js');
    const { RECIPIENT_DIRECTORY_PORT } = await import('../../../src/modules/notifications/application/ports/recipient-directory.port.js');
    const consumers = moduleRef.get<Array<{ consumerId: string }>>(EVENT_CONSUMERS);
    expect(consumers.map((consumer) => consumer.consumerId)).toEqual(['notifications.orchestrator']);
    const directory = moduleRef.get<{ resolve: (lookup: unknown) => Promise<{ status: string }> }>(RECIPIENT_DIRECTORY_PORT);
    const resolution = await directory.resolve({ tenantId: '1', recipient: { type: 'customer', id: '1' }, channel: 'sms' });
    expect(resolution.status).toBe('unsupported');
  });

  it('sin su base (credencial incorrecta) el arranque FALLA en vez de quedarse listo a medias', async () => {
    if (skipped) return;
    const { Test } = await import('@nestjs/testing');
    const { SequelizeModule } = await import('@nestjs/sequelize');
    const { Module } = await import('@nestjs/common');
    const { buildMessagingSequelizeOptions } = await import('../../../src/config/database.config.js');
    const { MessagingDatabaseGuardService } = await import('../../../src/bootstrap/messaging-database-guard.service.js');
    // `SequelizeModule.forRoot` NO autentica al construir (sólo con autoLoadModels): sin la guarda, el
    // proceso quedaría «listo» con una credencial mala hasta la primera consulta.
    @Module({
      imports: [
        SequelizeModule.forRoot({ ...buildMessagingSequelizeOptions(), password: 'not-the-password', retryAttempts: 0, models: [] }),
      ],
      providers: [MessagingDatabaseGuardService],
    })
    class Broken {}
    const broken = await Test.createTestingModule({ imports: [Broken] }).compile();
    await expect(broken.init()).rejects.toThrow(/password|authentication/i);
    await broken.close().catch(() => undefined);
  }, 30_000);
});
