import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { CustomerTelemetryService } from '../../../src/modules/customer-telemetry/customer-telemetry.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 2): primer test real de
 * `customer-telemetry`. El caso más importante de este
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
      createOnDeviceMetrics: jest.fn(async (values: unknown[]) => values),
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
    // Un solo bulkCreate para las N métricas (no una llamada por métrica — regresión N+1).
    expect(telemetryRepository.createOnDeviceMetrics).toHaveBeenCalledTimes(1);
    expect(telemetryRepository.createOnDeviceMetrics.mock.calls[0][0]).toHaveLength(2);
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

  describe('despacho por eventType (una rama por tipo, con metadata tipada y sin ella)', () => {
    const ev = (eventType: string, eventCode: string, metadata: Record<string, unknown> = {}) => ({
      eventType,
      eventCode,
      occurredAt: '2026-01-01T00:00:00.000Z',
      metadata,
    });
    const allTypes = (metadata: Record<string, unknown>) => [
      ev('form_field_interaction', 'nombre', metadata),
      ev('permission_event', 'location_granted', metadata),
      ev('auth_event', 'login', metadata),
      ev('device_risk_event', 'root_detected', metadata),
      ev('sim_observation', 'sim', metadata),
      ev('ip_reputation_observation', 'ip', metadata),
      ev('onboarding_step_event', 'step_1', metadata),
      ev('customer_action', 'screen_view', metadata),
      ev('tipo_desconocido', 'obs_code', metadata), // cae en el else -> observación de cliente
    ];

    function arrange(flow: unknown) {
      const built = buildService();
      (built.customersRepository.findById as jest.Mock).mockResolvedValue({ id: 'c1' } as never);
      (built.telemetryRepository.findCustomerDeviceLink as jest.Mock).mockResolvedValue({ id: 'link-1' } as never);
      (built.telemetryRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValue(flow as never);
      (built.telemetryRepository.createOnDeviceRun as jest.Mock).mockResolvedValue({ id: 'run-1' } as never);
      return built;
    }

    it('con metadata tipada completa persiste cada tipo con sus valores y liga el flow', async () => {
      const { service, telemetryRepository } = arrange({ id: 'flow-1' });
      const metadata = {
        interactionType: 'blur',
        usedCopyPaste: true,
        corrections: 3,
        durationMs: 1200,
        granted: true,
        loginSuccessful: false,
        failureReasonCode: 'BAD_PASSWORD',
        reasonCode: 'ROOT',
        eventType: 'completed',
        screenName: 'home',
      };

      const result = await service.ingestBatch(
        baseInput({
          body: baseBody({
            events: allTypes(metadata),
            onDeviceMetrics: [{ metricCode: 'typing_speed', value: '1.5', confidenceScore: 0.87, computedAt: '2026-01-01T00:00:00.000Z' }],
          }),
        }),
      );

      expect(result.acceptedEvents).toBe(9);
      expect((telemetryRepository.createFormFieldEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
        onboardingFlowId: 'flow-1', interactionType: 'blur', usedCopyPaste: true, correctionCount: 3, focusDurationMs: 1200,
      });
      expect((telemetryRepository.createPermissionEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ onboardingFlowId: 'flow-1', granted: true });
      expect((telemetryRepository.createAuthEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ loginSuccessful: false, failureReasonCode: 'BAD_PASSWORD' });
      expect((telemetryRepository.createDeviceRiskEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ reasonCode: 'ROOT' });
      expect(telemetryRepository.createSimObservation).toHaveBeenCalledTimes(1);
      expect(telemetryRepository.createIpReputation).toHaveBeenCalledTimes(1);
      expect((telemetryRepository.createOnboardingStepEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ eventType: 'completed', onboardingFlowId: 'flow-1' });
      expect((telemetryRepository.createCustomerAction as jest.Mock).mock.calls[0][0]).toMatchObject({ screenName: 'home' });
      expect((telemetryRepository.createCustomerObservation as jest.Mock).mock.calls[0][0]).toMatchObject({ observationCode: 'obs_code' });
      // confidenceScore definido -> se formatea a 4 decimales
      const metrics = (telemetryRepository.createOnDeviceMetrics as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(metrics[0]).toMatchObject({ metricCode: 'typing_speed', confidenceScore: '0.8700', computationRunId: 'run-1' });
    });

    it('sin metadata tipada aplica los defaults (interaction/telemetry/null) y sin flow deja los ids en null', async () => {
      const { service, telemetryRepository } = arrange(null);

      await service.ingestBatch(
        baseInput({
          body: baseBody({
            events: allTypes({}),
            onDeviceMetrics: [{ metricCode: 'm', value: '1' }], // sin confidenceScore ni computedAt
          }),
        }),
      );

      expect((telemetryRepository.createFormFieldEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
        onboardingFlowId: null, interactionType: 'interaction', usedCopyPaste: null, correctionCount: null, focusDurationMs: null,
      });
      // sin metadata.granted, se infiere del eventCode (contiene "granted")
      expect((telemetryRepository.createPermissionEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ granted: true });
      expect((telemetryRepository.createAuthEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ loginSuccessful: null, failureReasonCode: null });
      expect((telemetryRepository.createDeviceRiskEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ reasonCode: null });
      expect((telemetryRepository.createOnboardingStepEvent as jest.Mock).mock.calls[0][0]).toMatchObject({ eventType: 'telemetry', onboardingFlowId: null });
      expect((telemetryRepository.createCustomerAction as jest.Mock).mock.calls[0][0]).toMatchObject({ screenName: null });
      const metrics = (telemetryRepository.createOnDeviceMetrics as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(metrics[0]).toMatchObject({ confidenceScore: null });
    });
  });
});
