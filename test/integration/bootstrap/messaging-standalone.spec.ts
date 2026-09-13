/**
 * @file AT-057 — el worker de Mensajería se compone solo, con su identidad de base y sin Crédito ni Clientes.
 * @business El piloto no puede leer las tablas de Crédito o Clientes aunque quiera (PostgreSQL lo deniega),
 *   no importa los módulos del monolito, y sin su identidad propia no arranca: readiness no miente.
 * @system `Test.createTestingModule(...).compile()` resuelve el grafo COMPLETO de proveedores de la raíz
 *   real —que es lo que descubre un proveedor mal cableado— sin ejecutar `init()`: arrancar los efectos
 *   (Redis, temporizadores del relay, sondas) en una suite dejaba el proceso vivo y colgaba jest, y lo que
 *   hacen esos efectos ya está cubierto por las pruebas unitarias del bucle y de la guarda de identidad.
 *   Los privilegios reales se comprueban conectando directamente con el rol del piloto.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';

let moduleRef: TestingModule | null = null;
let pilotDb: Sequelize | null = null;
let skipped = false;
type Root = (typeof import('../../../src/bootstrap/messaging-worker.module.js'))['MessagingWorkerModule'];
let MessagingWorkerModule: Root;
let forbidden: readonly string[];

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
  MessagingWorkerModule = root.MessagingWorkerModule;
  forbidden = root.MESSAGING_FORBIDDEN_MODULES;

  const { Test } = await import('@nestjs/testing');
  // `compile()` resuelve TODOS los proveedores de la raíz: un token sin registrar falla aquí.
  moduleRef = await Test.createTestingModule({ imports: [MessagingWorkerModule] }).compile();

  // Conexión aparte con la identidad del piloto: es lo que prueba la frontera de privilegios.
  const { buildMessagingSequelizeOptions } = await import('../../../src/config/database.config.js');
  pilotDb = new Sequelize({ ...buildMessagingSequelizeOptions(), models: [], logging: false });
  await pilotDb.authenticate();
});

afterAll(async () => {
  await pilotDb?.close().catch(() => undefined);
  if (moduleRef) {
    // Import DINÁMICO, como todo lo que toca configuración en esta suite: `src/config/env.js` se evalúa
    // una sola vez al importarse, y un import estático aquí arriba lo cargaría ANTES de que `beforeAll`
    // fije `MESSAGING_DB_USER` —la conexión caería entonces a la identidad del monolito sin avisar—.
    const { REDIS_CLIENT } = await import('../../../src/common/redis/redis.module.js');
    // Redis se corta ANTES de cerrar el módulo: `RedisLifecycleService` hace `quit()`, que sobre un cliente
    // que nunca conectó se queda encolado esperando conexión y deja el proceso vivo («Jest did not exit»).
    moduleRef.get<{ disconnect?: () => void } | null>(REDIS_CLIENT, { strict: false })?.disconnect?.();
    await moduleRef.close().catch(() => undefined);
  }
});

function importNames(module: unknown): string[] {
  const list = (Reflect.getMetadata('imports', module as object) ?? []) as unknown[];
  return list.map((entry) =>
    typeof entry === 'function' ? entry.name : ((entry as { module?: { name: string } }).module?.name ?? 'dynamic'),
  );
}

describe('AT-057 · worker de Mensajería independiente', () => {
  it('Nest resuelve la raíz entera del piloto: ningún proveedor sin registrar', () => {
    if (skipped) return;
    expect(moduleRef).not.toBeNull();
  });

  it('la raíz no monta controladores ni importa los módulos del monolito', () => {
    if (skipped) return;
    expect(Reflect.getMetadata('controllers', MessagingWorkerModule) ?? []).toEqual([]);
    const names = importNames(MessagingWorkerModule);
    for (const name of forbidden) expect(names).not.toContain(name);
  });

  it('su identidad es la suya: lee Mensajería y el outbox, y Crédito y Clientes le están denegados', async () => {
    if (skipped || !pilotDb) return;
    const who = await pilotDb.query<{ u: string }>('SELECT current_user AS u', { type: QueryTypes.SELECT });
    expect(who[0].u).toBe('atlas_ctx_messaging');
    await expect(pilotDb.query('SELECT count(*) FROM messaging.notification_messages', { type: QueryTypes.SELECT })).resolves.toBeDefined();
    await expect(pilotDb.query('SELECT count(*) FROM platform_ops.outbox_events', { type: QueryTypes.SELECT })).resolves.toBeDefined();
    await expect(pilotDb.query('SELECT count(*) FROM credit.credit_applications', { type: QueryTypes.SELECT })).rejects.toThrow(
      /permission denied/,
    );
    await expect(pilotDb.query('SELECT count(*) FROM customer.customer_contact_methods', { type: QueryTypes.SELECT })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('lee la propiedad del contexto pero NO puede escribirla: la transferencia no es suya', async () => {
    if (skipped || !pilotDb) return;
    const rows = await pilotDb.query<{ owner: string }>("SELECT owner FROM platform_ops.context_ownership WHERE context = 'messaging'", {
      type: QueryTypes.SELECT,
    });
    expect(rows[0]?.owner).toBeDefined();
    await expect(
      pilotDb.query("UPDATE platform_ops.context_ownership SET owner = 'x' WHERE context = 'messaging'", { type: QueryTypes.UPDATE }),
    ).rejects.toThrow(/permission denied/);
  });

  it('el consumidor de Mensajería está registrado y el directorio es el remoto mientras no haya contrato configurado', async () => {
    if (skipped || !moduleRef) return;
    const { EVENT_CONSUMERS } = await import('../../../src/platform/events/event-consumer.port.js');
    const { RECIPIENT_DIRECTORY_PORT } = await import('../../../src/modules/notifications/application/ports/recipient-directory.port.js');
    const consumers = moduleRef.get<Array<{ consumerId: string }>>(EVENT_CONSUMERS);
    expect(consumers.map((consumer) => consumer.consumerId)).toEqual(['notifications.orchestrator']);
    const directory = moduleRef.get<{ resolve: (lookup: unknown) => Promise<{ status: string }> }>(RECIPIENT_DIRECTORY_PORT);
    const resolution = await directory.resolve({ tenantId: '1', recipient: { type: 'customer', id: '1' }, channel: 'sms' });
    expect(resolution.status).toBe('unsupported');
  });

  it('con una credencial que no es la suya, la conexión falla: el proceso no arrancaría', async () => {
    if (skipped) return;
    const { buildMessagingSequelizeOptions } = await import('../../../src/config/database.config.js');
    // `buildMessagingSequelizeOptions` devuelve opciones de Nest (`retryAttempts`/`retryDelay`), que el
    // constructor de Sequelize no conoce: se quedan fuera al construir la conexión suelta de esta prueba.
    const { retryAttempts, retryDelay, ...opciones } = buildMessagingSequelizeOptions();
    void retryAttempts;
    void retryDelay;
    const broken = new Sequelize({ ...opciones, password: 'not-the-password', models: [], logging: false });
    await expect(broken.authenticate()).rejects.toThrow(/password|authentication/i);
    await broken.close().catch(() => undefined);
  }, 30_000);
});
