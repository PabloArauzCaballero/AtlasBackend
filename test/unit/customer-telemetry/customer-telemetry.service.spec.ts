import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { CustomerTelemetryService } from '../../../src/modules/customer-telemetry/customer-telemetry.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 2): primer test real de
 * `customer-telemetry` (949 líneas, 0 tests hasta este patch). El caso más importante de este
 * archivo es `RAW_CONTACTS_NOT_ALLOWED`: convierte la regla de `MOBILE_DEVELOPMENT_CONTEXT.md`
 * §3 ("no subir agenda de contactos") de una promesa en documentación a algo que CI verifica en
 * cada PR.
 */
describe('CustomerTelemetryService.ingestBatch', () => {
  function buildService() {
    const telemetryRepository = {
      findCustomerDeviceLink: jest.fn(),
      findCustomerSession: jest.fn().mockResolvedValue({ id: 'session1' } as never),
      findLatestOnboardingFlow: jest.fn(),
      createFormFieldEvent: jest.fn(),
      createPermissionEvent: jest.fn(),
      createAuthEvent: jest.fn(),
      createDeviceRiskEvent: jest.fn(),
      createSimObservation: jest.fn(),
      createIpReputation: jest.fn(),
      createOnboardingStepEvent: jest.fn(),
      createCustomerAction: jest.fn(),
      createCustomerObservation: jest.fn(),
      createOnDeviceRun: jest.fn(),
      createOnDeviceMetric: jest.fn(),
      createBehaviorSummary: jest.fn(),
      upsertActivitySummary: jest.fn(),
      createAudit: jest.fn(),
    };
    const customersRepository = { findById: jest.fn() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new CustomerTelemetryService(telemetryRepository as never, customersRepository as never, sequelize as never);
    return { service, telemetryRepository, customersRepository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;
  const internalUser = { role: 'internal_operator', customerId: null, internalUserId: 'iu1', platformUserId: null } as never;

  function baseBody(overrides: Record<string, unknown> = {}) {
    return {
      clientBatchId: 'batch-1',
      deviceId: 'd1',
      sessionId: 's1',
      capturedUntil: '2026-01-01T00:00:00.000Z',
      events: [{ eventType: 'customer_action', eventCode: 'screen_view', occurredAt: '2026-01-01T00:00:00.000Z', metadata: {} }],
      onDeviceMetrics: [],
      ...overrides,
    };
  }

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: 't1',
      customerId: 'c1',
      body: baseBody() as never,
      currentUser: customerUser,
      idempotencyKey: 'idem-1',
      ipAddress: '10.0.0.1',
      ...overrides,
    };
  }

  it('throws BadRequestException without an idempotency key, before any repository call', async () => {
    const { service, customersRepository } = buildService();
    await expect(service.ingestBatch(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
    expect(customersRepository.findById).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when a customer token requests telemetry for a different customerId', async () => {
    const { service } = buildService();
    await expect(
      service.ingestBatch(baseInput({ customerId: 'someone-else', currentUser: { ...customerUser, customerId: 'c1' } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException when the batch has neither events nor onDeviceMetrics', async () => {
    const { service } = buildService();
    await expect(service.ingestBatch(baseInput({ body: baseBody({ events: [], onDeviceMetrics: [] }) }))).rejects.toThrow(
      /al menos un evento o métrica/,
    );
  });

  it('throws PayloadTooLargeException when the serialized body exceeds 250,000 characters', async () => {
    const { service } = buildService();
    const hugeMetadata = { blob: 'x'.repeat(260_000) };
    await expect(
      service.ingestBatch(
        baseInput({
          body: baseBody({
            events: [{ eventType: 'customer_action', eventCode: 'x', occurredAt: '2026-01-01T00:00:00.000Z', metadata: hugeMetadata }],
          }),
        }),
      ),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  describe('RAW_CONTACTS_NOT_ALLOWED — la regla de privacidad más estricta del proyecto', () => {
    const rawContactKeywords = ['rawContacts', 'contactList', 'phoneBook', 'agenda'];

    it.each(rawContactKeywords)('rejects a batch whose metadata mentions "%s", case-insensitively', async (keyword) => {
      const { service } = buildService();
      await expect(
        service.ingestBatch(
          baseInput({
            body: baseBody({
              events: [
                {
                  eventType: 'customer_action',
                  eventCode: 'x',
                  occurredAt: '2026-01-01T00:00:00.000Z',
                  metadata: { note: `dump of ${keyword.toUpperCase()}` },
                },
              ],
            }),
          }),
        ),
      ).rejects.toThrow(/RAW_CONTACTS_NOT_ALLOWED/);
    });

    it.each(['raw_contacts', 'contact-list', 'phone book', 'RAW-CONTACTS'])(
      'rejects "%s" too — separators must not bypass the keyword match',
      async (keyword) => {
        const { service } = buildService();
        await expect(
          service.ingestBatch(
            baseInput({
              body: baseBody({
                events: [
                  { eventType: 'customer_action', eventCode: 'x', occurredAt: '2026-01-01T00:00:00.000Z', metadata: { note: keyword } },
                ],
              }),
            }),
          ),
        ).rejects.toThrow(/RAW_CONTACTS_NOT_ALLOWED/);
      },
    );

    it('accepts a batch whose metadata does not mention any contact-dump keyword', async () => {
      const { service, customersRepository, telemetryRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);
      const result = await service.ingestBatch(baseInput());
      expect(result.status).toBe('accepted');
    });
  });

  it('throws NotFoundException when the customer does not exist', async () => {
    const { service, customersRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.ingestBatch(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when a customer role reports telemetry from a device not linked to them', async () => {
    const { service, customersRepository, telemetryRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.ingestBatch(baseInput({ currentUser: customerUser }))).rejects.toThrow(ForbiddenException);
  });

  it('does NOT require a device link when the actor is an internal role, not a customer', async () => {
    const { service, customersRepository, telemetryRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
    const result = await service.ingestBatch(baseInput({ currentUser: internalUser }));
    expect(result.status).toBe('accepted');
  });

  it('throws ForbiddenException when a customer role reports telemetry tagged with a sessionId that is not theirs', async () => {
    const { service, customersRepository, telemetryRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);
    (telemetryRepository.findCustomerSession as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.ingestBatch(baseInput({ currentUser: customerUser }))).rejects.toThrow(ForbiddenException);
  });

  it('does NOT require session ownership when the actor is an internal role, not a customer', async () => {
    const { service, customersRepository, telemetryRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce(null as never);
    (telemetryRepository.findCustomerSession as jest.Mock).mockResolvedValueOnce(null as never);
    const result = await service.ingestBatch(baseInput({ currentUser: internalUser }));
    expect(result.status).toBe('accepted');
  });

  describe('event type routing', () => {
    it('routes form_field_interaction events to createFormFieldEvent and counts them separately', async () => {
      const { service, customersRepository, telemetryRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);

      await service.ingestBatch(
        baseInput({
          body: baseBody({
            events: [
              { eventType: 'form_field_interaction', eventCode: 'phone_field', occurredAt: '2026-01-01T00:00:00.000Z', metadata: {} },
            ],
          }),
        }),
      );

      expect(telemetryRepository.createFormFieldEvent).toHaveBeenCalledTimes(1);
      const behaviorSummaryArgs = (telemetryRepository.createBehaviorSummary as jest.Mock).mock.calls[0][0] as { formEventCount: number };
      expect(behaviorSummaryArgs.formEventCount).toBe(1);
    });

    it('routes permission_event to createPermissionEvent and infers "granted" from the event code when metadata omits it', async () => {
      const { service, customersRepository, telemetryRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);

      await service.ingestBatch(
        baseInput({
          body: baseBody({
            events: [
              { eventType: 'permission_event', eventCode: 'location_granted', occurredAt: '2026-01-01T00:00:00.000Z', metadata: {} },
            ],
          }),
        }),
      );

      const args = (telemetryRepository.createPermissionEvent as jest.Mock).mock.calls[0][0] as { granted: boolean };
      expect(args.granted).toBe(true);
    });

    it('routes an unrecognized eventType to the generic createCustomerObservation fallback', async () => {
      const { service, customersRepository, telemetryRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);

      await service.ingestBatch(
        baseInput({
          body: baseBody({
            events: [{ eventType: 'some_future_event_type', eventCode: 'x', occurredAt: '2026-01-01T00:00:00.000Z', metadata: {} }],
          }),
        }),
      );

      expect(telemetryRepository.createCustomerObservation).toHaveBeenCalledTimes(1);
    });
  });

  it('creates one on-device computation run and N metrics when onDeviceMetrics is non-empty', async () => {
    const { service, customersRepository, telemetryRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);
    (telemetryRepository.createOnDeviceRun as jest.Mock).mockResolvedValueOnce({ id: 'run-1' } as never);

    const result = await service.ingestBatch(
      baseInput({
        body: baseBody({
          events: [],
          onDeviceMetrics: [
            { metricCode: 'contact_score', value: '0.5', computedAt: '2026-01-01T00:00:00.000Z' },
            { metricCode: 'sms_score', value: '0.2', computedAt: '2026-01-01T00:00:00.000Z' },
          ],
        }),
      }),
    );

    expect(telemetryRepository.createOnDeviceRun).toHaveBeenCalledTimes(1);
    expect(telemetryRepository.createOnDeviceMetric).toHaveBeenCalledTimes(2);
    expect(result.acceptedMetrics).toBe(2);
  });

  it('does not create an on-device run at all when onDeviceMetrics is empty', async () => {
    const { service, customersRepository, telemetryRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);

    await service.ingestBatch(baseInput());

    expect(telemetryRepository.createOnDeviceRun).not.toHaveBeenCalled();
  });

  it('always reports duplicatesIgnored: 0 — documents that dedup is not implemented in this method today', async () => {
    const { service, customersRepository, telemetryRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
    (telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValueOnce({ id: 'link1' } as never);
    const result = await service.ingestBatch(baseInput());
    expect(result.duplicatesIgnored).toBe(0);
  });
});
