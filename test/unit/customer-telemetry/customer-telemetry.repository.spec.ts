import { describe, expect, it, jest } from '@jest/globals';
import { CustomerTelemetryRepository } from '../../../src/modules/customer-telemetry/customer-telemetry.repository.js';

/**
 * Cobertura directa de `CustomerTelemetryRepository` (Fase 1.2 del plan 10/10): finders del contexto
 * de telemetría y las escrituras de eventos (form field, permiso, auth, auditoría). El servicio lo
 * mockea, así que su capa de persistencia no se ejercitaba. Los 17 modelos Sequelize se mockean.
 */
describe('CustomerTelemetryRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), bulkCreate: jest.fn() });
    // Orden EXACTO del constructor (17 modelos).
    const order = [
      'customerDeviceLink',
      'customerSession',
      'deviceRiskEvent',
      'simObservation',
      'authEvent',
      'ipReputationObservation',
      'customerActionLog',
      'onboardingFlow',
      'onboardingStepEvent',
      'formFieldInteractionEvent',
      'permissionEvent',
      'onboardingBehaviorSummary',
      'onDeviceComputationRun',
      'onDeviceMetricValue',
      'customerActivitySummary',
      'customerObservation',
      'operationalAuditLog',
    ] as const;
    const models = Object.fromEntries(order.map((k) => [k, make()])) as Record<(typeof order)[number], ReturnType<typeof make>>;
    const repo = new CustomerTelemetryRepository(
      models.customerDeviceLink as never,
      models.customerSession as never,
      models.deviceRiskEvent as never,
      models.simObservation as never,
      models.authEvent as never,
      models.ipReputationObservation as never,
      models.customerActionLog as never,
      models.onboardingFlow as never,
      models.onboardingStepEvent as never,
      models.formFieldInteractionEvent as never,
      models.permissionEvent as never,
      models.onboardingBehaviorSummary as never,
      models.onDeviceComputationRun as never,
      models.onDeviceMetricValue as never,
      models.customerActivitySummary as never,
      models.customerObservation as never,
      models.operationalAuditLog as never,
    );
    return { repo, models };
  }

  const tx = { transaction: 'tx' as never };

  describe('finders del contexto', () => {
    it('findCustomerDeviceLink filtra por tenant+cliente+dispositivo', async () => {
      const { repo, models } = buildRepo();
      (models.customerDeviceLink.findOne as jest.Mock).mockResolvedValue(null as never);
      await repo.findCustomerDeviceLink('t1', 'c1', 'd1');
      expect((models.customerDeviceLink.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
        where: { tenantId: 't1', customerId: 'c1', deviceId: 'd1' },
      });
    });

    it('findCustomerSession mapea sessionId -> id', async () => {
      const { repo, models } = buildRepo();
      (models.customerSession.findOne as jest.Mock).mockResolvedValue(null as never);
      await repo.findCustomerSession('t1', 'c1', 's1');
      expect((models.customerSession.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
        where: { tenantId: 't1', customerId: 'c1', id: 's1' },
      });
    });

    it('findLatestOnboardingFlow ordena por startedAt DESC', async () => {
      const { repo, models } = buildRepo();
      (models.onboardingFlow.findOne as jest.Mock).mockResolvedValue(null as never);
      await repo.findLatestOnboardingFlow('t1', 'c1');
      const options = (models.onboardingFlow.findOne as jest.Mock).mock.calls[0][0] as { order: unknown };
      expect(options.order).toEqual([
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ]);
    });
  });

  describe('escrituras de eventos', () => {
    it('createFormFieldEvent mapea la interacción y propaga la transacción', async () => {
      const { repo, models } = buildRepo();
      await repo.createFormFieldEvent(
        {
          tenantId: 't1',
          onboardingFlowId: 'f1',
          fieldCode: 'ci_number',
          interactionType: 'blur',
          usedCopyPaste: true,
          correctionCount: 2,
          focusDurationMs: 1500,
          occurredAt: new Date('2026-01-01'),
        },
        tx,
      );
      const [values, opts] = (models.formFieldInteractionEvent.create as jest.Mock).mock.calls[0];
      expect(values).toMatchObject({ fieldCode: 'ci_number', interactionType: 'blur', usedCopyPaste: true, correctionCount: 2 });
      expect(opts).toEqual({ transaction: 'tx' });
    });

    it('createPermissionEvent guarda el grant del permiso', async () => {
      const { repo, models } = buildRepo();
      await repo.createPermissionEvent(
        { tenantId: 't1', customerId: 'c1', sessionId: 's1', onboardingFlowId: null, permissionCode: 'location', granted: true, occurredAt: new Date('2026-01-01') },
        tx,
      );
      expect((models.permissionEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({ permissionCode: 'location', granted: true });
    });

    it('createAuthEvent registra el evento de autenticación del cliente', async () => {
      const { repo, models } = buildRepo();
      await repo.createAuthEvent(
        {
          tenantId: 't1',
          customerId: 'c1',
          sessionId: 's1',
          deviceId: 'd1',
          eventType: 'login',
          loginSuccessful: true,
          failureReasonCode: null,
          occurredAt: new Date('2026-01-01'),
          ipAddress: '127.0.0.1',
        },
        tx,
      );
      expect((models.authEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({ eventType: 'login', loginSuccessful: true });
    });

    it('createAudit escribe en operational_audit_logs', async () => {
      const { repo, models } = buildRepo();
      await repo.createAudit(
        {
          tenantId: 't1',
          actorType: 'system',
          actorInternalUserId: null,
          actorPlatformUserId: null,
          actionCode: 'telemetry.ingest',
          targetType: 'customer',
          targetId: 'c1',
          ipAddress: null,
          payload: { n: 1 },
          occurredAt: new Date('2026-01-01'),
        },
        tx,
      );
      expect((models.operationalAuditLog.create as jest.Mock).mock.calls[0][0]).toMatchObject({ actionCode: 'telemetry.ingest', targetId: 'c1' });
    });
  });

  describe('escrituras adicionales', () => {
    const base = { tenantId: 't1', customerId: 'c1', sessionId: 's1', deviceId: 'd1', onboardingFlowId: 'f1', occurredAt: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), metadata: {}, signalsJson: {}, payload: {}, summary: {}, snapshotJson: {} };

    it('los creates simples delegan cada uno en su modelo', async () => {
      const { repo, models } = buildRepo();
      await repo.createDeviceRiskEvent({ ...base, eventType: 'x', riskScore: '0.5', signalsJson: {} } as never, tx);
      await repo.createSimObservation({ ...base, simSerialHash: 'h', carrierCode: 'c' } as never, tx);
      await repo.createIpReputation({ ...base, ipAddressHash: 'h', reputationScore: '0.5' } as never, tx);
      await repo.createCustomerAction({ ...base, actionCode: 'a', metadata: {} } as never, tx);
      await repo.createOnboardingStepEvent({ ...base, stepCode: 's', eventType: 'e' } as never, tx);
      await repo.createCustomerObservation({ ...base, observationCode: 'o', payload: {} } as never, tx);
      await repo.createOnDeviceRun({ ...base, runCode: 'r', status: 'ok', summary: {} } as never, tx);
      expect(models.deviceRiskEvent.create).toHaveBeenCalledTimes(1);
      expect(models.simObservation.create).toHaveBeenCalledTimes(1);
      expect(models.ipReputationObservation.create).toHaveBeenCalledTimes(1);
      expect(models.customerActionLog.create).toHaveBeenCalledTimes(1);
      expect(models.onboardingStepEvent.create).toHaveBeenCalledTimes(1);
      expect(models.customerObservation.create).toHaveBeenCalledTimes(1);
      expect(models.onDeviceComputationRun.create).toHaveBeenCalledTimes(1);
    });

    it('createOnDeviceMetric mapea el value según su tipo', async () => {
      const { repo, models } = buildRepo();
      await repo.createOnDeviceMetric({ ...base, computationRunId: 'r1', metricCode: 'm', value: 0.5, confidenceScore: null } as never, tx);
      await repo.createOnDeviceMetric({ ...base, computationRunId: 'r1', metricCode: 'm', value: 'x', confidenceScore: null } as never, tx);
      await repo.createOnDeviceMetric({ ...base, computationRunId: 'r1', metricCode: 'm', value: { a: 1 }, confidenceScore: null } as never, tx);
      const calls = (models.onDeviceMetricValue.create as jest.Mock).mock.calls;
      expect(calls[0][0]).toMatchObject({ valueNumber: '0.5000', valueText: null, valueBoolean: null });
      expect(calls[1][0]).toMatchObject({ valueText: 'x' });
      expect(calls[2][0]).toMatchObject({ valueJson: { a: 1 } });
    });

    it('createOnDeviceMetrics corta con lista vacía y hace bulkCreate con datos', async () => {
      const empty = buildRepo();
      await empty.repo.createOnDeviceMetrics([], tx);
      expect(empty.models.onDeviceMetricValue.bulkCreate).not.toHaveBeenCalled();

      const { repo, models } = buildRepo();
      await repo.createOnDeviceMetrics([{ ...base, computationRunId: 'r', metricCode: 'm', value: true, confidenceScore: null }] as never, tx);
      expect(((models.onDeviceMetricValue.bulkCreate as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>)[0]).toMatchObject({ valueBoolean: true });
    });

    it('createBehaviorSummary fija permissionGrantScore según el conteo de permisos', async () => {
      const { repo, models } = buildRepo();
      await repo.createBehaviorSummary({ ...base, formEventCount: 0, permissionEventCount: 2, computedAt: base.occurredAt } as never, tx);
      await repo.createBehaviorSummary({ ...base, formEventCount: 0, permissionEventCount: 0, computedAt: base.occurredAt } as never, tx);
      const calls = (models.onboardingBehaviorSummary.create as jest.Mock).mock.calls;
      expect(calls[0][0].permissionGrantScore).toBe('1.0000');
      expect(calls[1][0].permissionGrantScore).toBeNull();
    });

    it('upsertActivitySummary crea si no existe, o actualiza (totalSessions+1) el existente', async () => {
      const creating = buildRepo();
      (creating.models.customerActivitySummary.findOne as jest.Mock).mockResolvedValue(null as never);
      await creating.repo.upsertActivitySummary({ ...base, eventCount: 3, now: base.occurredAt } as never, tx);
      expect(creating.models.customerActivitySummary.create).toHaveBeenCalledTimes(1);

      const updating = buildRepo();
      const save = jest.fn(async () => undefined);
      const existing = { totalSessions: 5, save } as Record<string, unknown>;
      (updating.models.customerActivitySummary.findOne as jest.Mock).mockResolvedValue(existing as never);
      await updating.repo.upsertActivitySummary({ ...base, eventCount: 1, now: base.occurredAt } as never, tx);
      expect(existing.totalSessions).toBe(6);
      expect(save).toHaveBeenCalledTimes(1);
      expect(updating.models.customerActivitySummary.create).not.toHaveBeenCalled();
    });
  });
});
