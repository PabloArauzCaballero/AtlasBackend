import { describe, expect, it, jest } from '@jest/globals';
import { generateKeyPairSync } from 'node:crypto';
import { PushNotificationAdapter } from '../../../src/modules/notifications/adapters/push.adapter.js';
import { ApnsRequest, resetApnsTokenCache } from '../../../src/modules/notifications/adapters/apns.util.js';

/**
 * `PushNotificationAdapter.send`: ramas de guarda (disabled / proveedor no soportado / webhook sin url
 * / sin tokens FCM), el camino webhook (éxito y fallo) y el camino FCM completo (firma RS256 real con
 * una clave RSA generada en el test → token OAuth JWT-bearer → envío). Executor mockeado: resolver =
 * HTTP ok, rechazar = HTTP fallo (así lo traduce callResilient).
 */
describe('PushNotificationAdapter', () => {
  function build(provider: string, webhookUrl: string | null = null) {
    const config = { getPushProvider: () => provider, require: () => 'val', getWebhookUrl: () => webhookUrl };
    const executor = { run: jest.fn() };
    return { adapter: new PushNotificationAdapter(config as never, executor as never), executor };
  }
  const msg = (payload: Record<string, unknown> = { fcmToken: 'tok1' }) =>
    ({ id: '1', channel: 'push', title: 'T', body: 'b', payload, deliveryTargets: [] }) as never;

  it('supports y validatePayload', () => {
    const { adapter } = build('fcm');
    expect(adapter.supports('push')).toBe(true);
    expect(adapter.validatePayload({ channel: 'push', body: 'b' } as never)).toBe(true);
    expect(adapter.validatePayload({ channel: 'push', body: '' } as never)).toBe(false);
  });

  it('ramas de guarda: disabled / no soportado / webhook sin url / sin tokens FCM', async () => {
    expect(await build('disabled').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'PUSH_PROVIDER_DISABLED' });
    expect(await build('onesignal').adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_PUSH_PROVIDER' });
    expect(await build('webhook', null).adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_URL_MISSING' });
    expect(await build('fcm').adapter.send(msg({}))).toMatchObject({ status: 'failed', errorCode: 'MISSING_FCM_TOKENS' });
  });

  it('webhook: éxito devuelve sent; fallo (executor rechaza) devuelve failed', async () => {
    const ok = build('webhook', 'https://hooks.example.com/push');
    (ok.executor.run as jest.Mock).mockResolvedValue({ status: 200, json: { id: 'w1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'webhook_push', providerMessageId: 'w1' });

    const bad = build('webhook', 'https://hooks.example.com/push');
    (bad.executor.run as jest.Mock).mockRejectedValue(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'WEBHOOK_PUSH_FAILED' });
  });

  it('fcm: firma el JWT con la clave real, obtiene el token OAuth y envía (éxito); fallo del envío -> FCM_SEND_FAILED', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const buildFcm = () => {
      const config = {
        getPushProvider: () => 'fcm',
        require: (_v: unknown, code: string) => (code === 'FCM_PRIVATE_KEY_MISSING' ? privateKey : 'val'),
        getWebhookUrl: () => null,
      };
      const executor = { run: jest.fn() };
      return { adapter: new PushNotificationAdapter(config as never, executor as never), executor };
    };

    const ok = buildFcm();
    (ok.executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { access_token: 'tok' } } as never)
      .mockResolvedValueOnce({ status: 200, json: { name: 'projects/x/messages/1' } } as never);
    expect(await ok.adapter.send(msg())).toMatchObject({ status: 'sent', provider: 'fcm', providerMessageId: 'projects/x/messages/1' });

    const bad = buildFcm();
    (bad.executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { access_token: 'tok' } } as never)
      .mockRejectedValueOnce(new Error('boom') as never);
    expect(await bad.adapter.send(msg())).toMatchObject({ status: 'failed', errorCode: 'FCM_SEND_FAILED' });
  });

  it('fcm: token OAuth inválido (rechaza) propaga el fallo', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const config = {
      getPushProvider: () => 'fcm',
      require: (_v: unknown, code: string) => (code === 'FCM_PRIVATE_KEY_MISSING' ? privateKey : 'val'),
      getWebhookUrl: () => null,
    };
    const executor = { run: jest.fn() };
    (executor.run as jest.Mock).mockRejectedValueOnce(new Error('token boom') as never);
    const adapter = new PushNotificationAdapter(config as never, executor as never);
    await expect(adapter.send(msg())).rejects.toThrow(/FCM_TOKEN_FAILED/);
  });

  describe('iPhone (APNs)', () => {
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const { privateKey: privateKeyRsa } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const credenciales = {
      ok: true as const,
      value: { keyId: 'KID1', teamId: 'TEAM1', privateKey, bundleId: 'bo.atlas.consumer', production: true },
    };

    const mensaje = (targets: Array<{ address: string; platform: string }>) =>
      ({
        id: 'm1',
        channel: 'push',
        title: 'T',
        body: 'b',
        payload: {},
        deliveryTargets: targets.map((t) => ({ kind: 'fcm_token', address: t.address, metadata: { platform: t.platform } })),
      }) as never;

    it('sin credenciales de Apple lo dice, en vez de mandarlo a FCM y culpar a Firebase', async () => {
      const config = {
        getPushProvider: () => 'fcm',
        require: () => 'val',
        getWebhookUrl: () => null,
        getApnsCredentials: () => ({ ok: false, missing: 'APNS_KEY_ID' }),
      };
      const adapter = new PushNotificationAdapter(config as never, { run: jest.fn() } as never);

      const resultado = await adapter.send(mensaje([{ address: 'ios-1', platform: 'ios' }]));

      expect(resultado).toMatchObject({ status: 'failed', provider: 'apns', errorCode: 'APNS_NOT_CONFIGURED' });
    });

    it('manda el iPhone por APNs y el Android por FCM en el mismo mensaje', async () => {
      resetApnsTokenCache();
      const capturado: ApnsRequest[] = [];
      const transporte = async (_host: string, requests: ApnsRequest[]) => {
        capturado.push(...requests);
        return requests.map((r) => ({ token: r.token, status: 200, body: '' }));
      };
      const config = {
        getPushProvider: () => 'fcm',
        require: (_v: unknown, code: string) => (code === 'FCM_PRIVATE_KEY_MISSING' ? privateKeyRsa : 'val'),
        getWebhookUrl: () => null,
        getApnsCredentials: () => credenciales,
      };
      const executor = { run: jest.fn() };
      (executor.run as jest.Mock)
        .mockResolvedValueOnce({ status: 200, json: { access_token: 'oauth' } } as never)
        .mockResolvedValueOnce({ status: 200, json: { name: 'projects/x/messages/1' } } as never);
      const adapter = new PushNotificationAdapter(config as never, executor as never, transporte);

      const resultado = await adapter.send(
        mensaje([
          { address: 'ios-1', platform: 'ios' },
          { address: 'android-1', platform: 'android' },
        ]),
      );

      expect(resultado.status).toBe('sent');
      // Al iPhone sólo el suyo: un token de Apple mandado a FCM se rechaza siempre.
      expect(capturado.map((r) => r.token)).toEqual(['ios-1']);
      expect(resultado.response).toMatchObject({ count: 1, apns: { count: 1 } });
    });

    /**
     * El 410 de Apple es «este aparato ya no existe», no un fallo de entrega.
     *
     * Antes se contaba en la respuesta y nada más: el token seguía activo y se le reintentaba en cada
     * aviso, para siempre. Apple penaliza a quien insiste contra tokens muertos, así que la baja no es
     * limpieza cosmética sino lo que protege la reputación de envío.
     */
    describe('tokens que Apple declara muertos (410)', () => {
      const configApns = {
        getPushProvider: () => 'fcm',
        require: () => 'val',
        getWebhookUrl: () => null,
        getApnsCredentials: () => credenciales,
      };
      /*
        Ojo con la forma de la respuesta: un mensaje SOLO para iPhone devuelve la de APNs TAL CUAL,
        y solo cuando el mismo envio lleva tambien Android queda anidada bajo `apns`. Escribir aqui
        `{ apns: ... }` hace que `toMatchObject` no encuentre nada y el fallo parezca de la baja.
      */
      /** Devuelve 410 para los tokens indicados y 200 para el resto. */
      const transporteCon410 = (muertos: string[]) => async (_host: string, requests: ApnsRequest[]) =>
        requests.map((r) => ({ token: r.token, status: muertos.includes(r.token) ? 410 : 200, body: '{"reason":"Unregistered"}' }));

      it('da de baja SOLO el token muerto, y la entrega sigue siendo un éxito', async () => {
        resetApnsTokenCache();
        const registro = { deactivate: jest.fn(async () => 1) };
        const adapter = new PushNotificationAdapter(
          configApns as never,
          { run: jest.fn() } as never,
          transporteCon410(['ios-muerto']),
          registro as never,
        );

        const resultado = await adapter.send(
          mensaje([
            { address: 'ios-muerto', platform: 'ios' },
            { address: 'ios-vivo', platform: 'ios' },
          ]),
        );

        expect(registro.deactivate).toHaveBeenCalledWith(['ios-muerto']);
        // Un 410 NO es fallo: el mensaje salió para el que sí existe.
        expect(resultado.status).toBe('sent');
        expect(resultado.response).toMatchObject({ count: 2, unregistered: 1, deactivated: 1 });
      });

      it('sin ningún 410 no toca la base', async () => {
        resetApnsTokenCache();
        const registro = { deactivate: jest.fn(async () => 0) };
        const adapter = new PushNotificationAdapter(
          configApns as never,
          { run: jest.fn() } as never,
          transporteCon410([]),
          registro as never,
        );

        const resultado = await adapter.send(mensaje([{ address: 'ios-vivo', platform: 'ios' }]));

        expect(registro.deactivate).not.toHaveBeenCalled();
        expect(resultado.response).toMatchObject({ unregistered: 0, deactivated: 0 });
      });

      it('si la base falla, el aviso YA salió: no se convierte en fallido', async () => {
        resetApnsTokenCache();
        const registro = {
          deactivate: jest.fn(async () => {
            throw new Error('base caida');
          }),
        };
        const adapter = new PushNotificationAdapter(
          configApns as never,
          { run: jest.fn() } as never,
          transporteCon410(['ios-muerto']),
          registro as never,
        );

        const resultado = await adapter.send(mensaje([{ address: 'ios-muerto', platform: 'ios' }]));

        // Marcarlo failed haría reintentar un mensaje ya entregado.
        expect(resultado.status).toBe('sent');
        expect(resultado.response).toMatchObject({ unregistered: 1, deactivationFailed: 'base caida' });
      });

      it('sin puerto cableado lo DICE, en vez de aparentar que dio de baja cero', async () => {
        resetApnsTokenCache();
        const adapter = new PushNotificationAdapter(configApns as never, { run: jest.fn() } as never, transporteCon410(['ios-muerto']));

        const resultado = await adapter.send(mensaje([{ address: 'ios-muerto', platform: 'ios' }]));

        expect(resultado.response).toMatchObject({ unregistered: 1, deactivationUnavailable: true });
      });
    });
  });
});

/**
 * Que NEST pueda construirlo, no sólo `new`.
 *
 * Esta prueba existe por una caída real en producción: el transporte de APNs entró como tercer
 * parámetro del constructor y, aunque en TypeScript era opcional, Nest intentó resolverlo —un tipo
 * función no es un proveedor— y el contenedor entero se quedó reiniciando con
 * «can't resolve dependencies ... argument at index [2]». Las pruebas de arriba no lo vieron porque
 * instancian la clase a mano, que es justo lo que el arranque real NO hace.
 */
describe('PushNotificationAdapter · construcción por Nest', () => {
  it('el contenedor lo resuelve sin proveedor para el transporte de APNs', async () => {
    const { Test } = await import('@nestjs/testing');
    const { NotificationProviderConfigService } =
      await import('../../../src/modules/notifications/adapters/notification-provider-config.service.js');
    const { ResilientAdapterExecutorService } = await import('../../../src/common/resilience/resilient-adapter-executor.service.js');

    const moduleRef = await Test.createTestingModule({
      providers: [
        PushNotificationAdapter,
        { provide: NotificationProviderConfigService, useValue: { getPushProvider: () => 'disabled' } },
        { provide: ResilientAdapterExecutorService, useValue: { run: jest.fn() } },
      ],
    }).compile();

    expect(moduleRef.get(PushNotificationAdapter)).toBeInstanceOf(PushNotificationAdapter);
  });
});
