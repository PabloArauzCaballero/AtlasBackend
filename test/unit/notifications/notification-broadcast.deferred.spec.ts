import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NotificationBroadcastService } from '../../../src/modules/notifications/notification-broadcast.service.js';
import { env } from '../../../src/config/env.js';

/**
 * Entrega DIFERIDA de broadcasts (`docs/architecture/background-processing.md` §2.4).
 *
 * El problema que cierra: con la entrega dentro del proceso de API, un despliegue a mitad de tanda
 * deja mensajes creados que sólo recoge `retry_stuck_notifications` —hasta 20 minutos después—.
 * En modo `deferred` el request no toca el orquestador: los mensajes quedan persistidos en
 * `pending` y no hay ninguna tanda en vuelo que un reinicio pueda perder.
 *
 * La prueba clave es la negativa: que `deliverMessage` NO se llame. Un fallo aquí no rompe nada
 * visible —los mensajes se entregarían igual, sólo que en el proceso equivocado—, así que sin esta
 * aserción la regresión sería invisible.
 */
function buildService() {
  const notificationsRepository = {
    createBroadcastMessages: jest.fn(async (recipients: Array<{ recipientId: string }>) =>
      recipients.map((recipient, index) => ({ id: `msg-${index}-${recipient.recipientId}` })),
    ),
  };
  const orchestrator = { deliverMessage: jest.fn(async (..._args: unknown[]) => undefined) };
  const customersRepository = { listActiveCustomerIds: jest.fn(async (..._args: unknown[]) => ['c1', 'c2']) };
  const internalRbacRepository = { listActiveInternalUserIds: jest.fn(async (..._args: unknown[]) => ['iu1']) };
  const tenantModel = { findAll: jest.fn(async (..._args: unknown[]) => [{ id: 't1' }]) };

  const service = new NotificationBroadcastService(
    notificationsRepository as never,
    orchestrator as never,
    customersRepository as never,
    internalRbacRepository as never,
    tenantModel as never,
  );
  return { service, notificationsRepository, orchestrator };
}

const input = { audience: 'customers' as const, title: 'Aviso', body: 'Cuerpo', priority: 10 };
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('NotificationBroadcastService · entrega diferida', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const original = { APP_ROLE: mutableEnv['APP_ROLE'], NOTIFICATIONS_DELIVERY_MODE: mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] };

  afterEach(() => {
    mutableEnv['APP_ROLE'] = original.APP_ROLE;
    mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = original.NOTIFICATIONS_DELIVERY_MODE;
  });

  it('en la API con modo deferred crea los mensajes pero NO los entrega', async () => {
    mutableEnv['APP_ROLE'] = 'api';
    mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = 'deferred';
    const { service, notificationsRepository, orchestrator } = buildService();

    const result = await service.broadcast('t1', input as never);
    await flush();

    expect(notificationsRepository.createBroadcastMessages).toHaveBeenCalledTimes(1);
    expect(orchestrator.deliverMessage).not.toHaveBeenCalled();
    // El contrato con el cliente no cambia: sigue siendo "encolado", que es lo que era.
    expect(result).toMatchObject({ status: 'queued', targeted: 2, created: 2 });
  });

  it('en modo inline entrega en el propio proceso, como siempre', async () => {
    mutableEnv['APP_ROLE'] = 'api';
    mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = 'inline';
    const { service, orchestrator } = buildService();

    await service.broadcast('t1', input as never);
    await flush();

    expect(orchestrator.deliverMessage).toHaveBeenCalledTimes(2);
  });

  it('el worker entrega aunque el modo sea deferred: no tiene a quién diferirle el trabajo', async () => {
    mutableEnv['APP_ROLE'] = 'worker';
    mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = 'deferred';
    const { service, orchestrator } = buildService();

    await service.broadcast('t1', input as never);
    await flush();

    expect(orchestrator.deliverMessage).toHaveBeenCalledTimes(2);
  });

  it('la alerta interna del monitor de salud se entrega SIEMPRE de forma síncrona', async () => {
    // `notifyAllInternalUsers` usa `awaitDelivery: true`: son pocos destinatarios y el aviso de que
    // una herramienta crítica cayó no puede depender de que el planificador llegue a su próxima tanda.
    mutableEnv['APP_ROLE'] = 'api';
    mutableEnv['NOTIFICATIONS_DELIVERY_MODE'] = 'deferred';
    const { service, orchestrator } = buildService();

    await service.notifyAllInternalUsers('t1', { title: 'Postgres caído', body: 'x', priority: 100, category: 'health' });

    expect(orchestrator.deliverMessage).toHaveBeenCalledTimes(1);
  });
});
