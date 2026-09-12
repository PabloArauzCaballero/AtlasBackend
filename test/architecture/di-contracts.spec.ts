/**
 * @file AT-014 — la inversión de dependencias es real: un puerto se satisface con un fake y un caso
 *   de uso se compone sin Sequelize; un provider ausente falla de forma explícita al componer.
 * @business Poner una «I» delante de la misma clase no desacopla nada; que el caso de uso corra con
 *   un doble del puerto y sin ORM, sí.
 * @system Composición Nest real (`Test.createTestingModule`) para el caso negativo; construcción a
 *   mano con fakes para el positivo.
 */
import { describe, expect, it } from '@jest/globals';
import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustomerEligibilityService } from '../../src/modules/customers/application/customer-eligibility.service.js';
import { NOTIFICATION_REQUEST_PORT, type NotificationRequestPort } from '../../src/modules/notifications/public/index.js';
import { CLOCK, fixedClock, type Clock } from '../../src/platform/di/clock.js';
import { PlatformModule } from '../../src/platform/platform.module.js';

@Injectable()
class NeedsClockAndNotifications {
  constructor(
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(NOTIFICATION_REQUEST_PORT) readonly notifications: NotificationRequestPort,
  ) {}
}

describe('contratos de inyección (AT-014)', () => {
  it('un fake satisface el puerto y el caso de uso se compone sin Sequelize', async () => {
    const sent: unknown[] = [];
    const fakeNotifications: NotificationRequestPort = {
      request: async (input, context) => {
        sent.push({ input, context });
        return { notificationId: 'n-1', accepted: true, status: 'pending', deduplicated: false };
      },
    };
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformModule],
      providers: [
        NeedsClockAndNotifications,
        { provide: NOTIFICATION_REQUEST_PORT, useValue: fakeNotifications },
        { provide: CLOCK, useValue: fixedClock('2026-01-01') },
      ],
    }).compile();
    const useCase = moduleRef.get(NeedsClockAndNotifications);
    const result = await useCase.notifications.request(
      { recipient: { type: 'customer', id: '1' }, channel: 'in_app', templateCode: null, title: 't', body: 'b', payload: {} },
      { tenantId: '1', correlationId: null },
    );
    expect(result.notificationId).toBe('n-1');
    expect(useCase.clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(sent).toHaveLength(1);
    await moduleRef.close();
  });

  it('falta un provider: la composición falla de manera explícita, nombrando el token', async () => {
    await expect(
      Test.createTestingModule({ imports: [PlatformModule], providers: [NeedsClockAndNotifications] }).compile(),
    ).rejects.toThrow(/atlas\.notifications\.request-port/);
  });

  it('el reloj es un puerto con implementación por defecto: el servicio se construye sin Nest', async () => {
    const service = new CustomerEligibilityService({} as never, {} as never, {} as never, {} as never, {} as never);
    expect(typeof (service as unknown as { clock: Clock }).clock.now().getTime()).toBe('number');
  });
});
