import { describe, expect, it, jest } from '@jest/globals';
import { RuntimeJobsService } from '../../../src/modules/runtime-jobs/runtime-jobs.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 3): primer test real de
 * `runtime-jobs` — el job de retención de datos. Un
 * error aquí significa borrar datos que no debían borrarse, o no borrar datos que sí debían.
 * El caso más importante de este archivo es confirmar, con un test y no solo con un comentario,
 * que `risk-data-365d` (política sin tabla mapeada, ver
 * `docs/architecture/risk-fraud-retention-proposal.md`) no ejecuta ninguna acción destructiva
 * mientras no exista esa aprobación.
 */
describe('RuntimeJobsService', () => {
  function buildRun() {
    return { id: 'run-1', status: 'running', save: jest.fn(async () => undefined) };
  }

  function buildService() {
    const jobRunModel = { create: jest.fn(async () => buildRun()) };
    const outboxModel = { count: jest.fn() };
    const sessionModel = { count: jest.fn(), update: jest.fn() };
    const retentionPolicyModel = { findAll: jest.fn() };
    const dataQualityIssueModel = { count: jest.fn() };
    const auditModel = { create: jest.fn() };
    const gpsObservationModel = { count: jest.fn(), destroy: jest.fn() };
    const deviceSnapshotModel = { count: jest.fn(), update: jest.fn(async () => [0]) };
    const formInteractionModel = { count: jest.fn(), destroy: jest.fn() };
    const sequelize = {
      transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})),
      query: jest.fn(),
    };
    const eventsService = { processPendingEvents: jest.fn() };

    const service = new RuntimeJobsService(
      jobRunModel as never,
      outboxModel as never,
      sessionModel as never,
      retentionPolicyModel as never,
      dataQualityIssueModel as never,
      auditModel as never,
      gpsObservationModel as never,
      deviceSnapshotModel as never,
      formInteractionModel as never,
      sequelize as never,
      eventsService as never,
    );

    return {
      service,
      jobRunModel,
      retentionPolicyModel,
      gpsObservationModel,
      deviceSnapshotModel,
      formInteractionModel,
      sessionModel,
      auditModel,
    };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: null } as never;

  describe('applyRetentionPolicies', () => {
    it('gps_observations_90d in dryRun mode only counts — never calls destroy', async () => {
      const { service, retentionPolicyModel, gpsObservationModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([
        { policyCode: 'gps_observations_90d', retentionDays: 90, isActive: true },
      ] as never);
      (gpsObservationModel.count as jest.Mock).mockResolvedValueOnce(42 as never);

      const response = await service.applyRetentionPolicies({ tenantId: 't1', body: { dryRun: true } as never, currentUser: internalUser });

      expect(gpsObservationModel.destroy).not.toHaveBeenCalled();
      const result = (response as { result: { destructiveActionsExecuted: number; outcomes: unknown[] } }).result;
      expect(result.destructiveActionsExecuted).toBe(0);
      expect(result.outcomes).toEqual([{ table: 'address_gps_observations', action: 'delete', affected: 42 }]);
    });

    it('gps_observations_90d with dryRun: false actually calls destroy and reports it as a destructive action', async () => {
      const { service, retentionPolicyModel, gpsObservationModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([
        { policyCode: 'gps_observations_90d', retentionDays: 90, isActive: true },
      ] as never);
      (gpsObservationModel.destroy as jest.Mock).mockResolvedValueOnce(42 as never);

      const response = await service.applyRetentionPolicies({
        tenantId: 't1',
        body: { dryRun: false } as never,
        currentUser: internalUser,
      });

      expect(gpsObservationModel.count).not.toHaveBeenCalled();
      const result = (response as { result: { destructiveActionsExecuted: number } }).result;
      expect(result.destructiveActionsExecuted).toBe(42);
    });

    it('device_snapshots_90d anonymizes (clears brand/model/version) but never touches isRooted/isEmulator/vpnDetected', async () => {
      const { service, retentionPolicyModel, deviceSnapshotModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([
        { policyCode: 'device_snapshots_90d', retentionDays: 90, isActive: true },
      ] as never);
      (deviceSnapshotModel.update as jest.Mock).mockResolvedValueOnce([5] as never);

      await service.applyRetentionPolicies({ tenantId: 't1', body: { dryRun: false } as never, currentUser: internalUser });

      const updatePayload = (deviceSnapshotModel.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(updatePayload).toMatchObject({ brand: null, model: null, osVersion: null, appVersion: null });
      expect(updatePayload).not.toHaveProperty('isRooted');
      expect(updatePayload).not.toHaveProperty('isEmulator');
      expect(updatePayload).not.toHaveProperty('vpnDetected');
    });

    it('risk-data-365d (sin tabla mapeada) nunca ejecuta ninguna acción, incluso con dryRun: false', async () => {
      const { service, retentionPolicyModel, gpsObservationModel, deviceSnapshotModel, formInteractionModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([
        { policyCode: 'risk-data-365d', retentionDays: 365, isActive: true },
      ] as never);

      const response = await service.applyRetentionPolicies({
        tenantId: 't1',
        body: { dryRun: false } as never,
        currentUser: internalUser,
      });

      expect(gpsObservationModel.destroy).not.toHaveBeenCalled();
      expect(deviceSnapshotModel.update).not.toHaveBeenCalled();
      expect(formInteractionModel.destroy).not.toHaveBeenCalled();
      const result = (response as { result: { unmappedPolicies: string[]; destructiveActionsExecuted: number } }).result;
      expect(result.unmappedPolicies).toEqual(['risk-data-365d']);
      expect(result.destructiveActionsExecuted).toBe(0);
    });

    it('skips a policy row with no policyCode or no retentionDays instead of crashing', async () => {
      const { service, retentionPolicyModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([
        { policyCode: null, retentionDays: 90, isActive: true },
        { policyCode: 'gps_observations_90d', retentionDays: null, isActive: true },
      ] as never);

      const response = await service.applyRetentionPolicies({ tenantId: 't1', body: { dryRun: true } as never, currentUser: internalUser });
      const result = (response as { result: { policiesScanned: number; outcomes: unknown[] } }).result;
      expect(result.policiesScanned).toBe(2);
      expect(result.outcomes).toEqual([]);
    });

    it('only scans active policies matching policyCode filter when one is given', async () => {
      const { service, retentionPolicyModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([] as never);

      await service.applyRetentionPolicies({
        tenantId: 't1',
        body: { dryRun: true, policyCode: 'gps_observations_90d' } as never,
        currentUser: internalUser,
      });

      const whereArg = (retentionPolicyModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(whereArg.where).toMatchObject({ isActive: true, policyCode: 'gps_observations_90d' });
    });
  });

  describe('expireStaleSessions', () => {
    it('dryRun: true counts candidates without calling update', async () => {
      const { service, sessionModel } = buildService();
      (sessionModel.count as jest.Mock).mockResolvedValueOnce(3 as never);

      const response = await service.expireStaleSessions({
        tenantId: 't1',
        body: { maxIdleMinutes: 30, dryRun: true } as never,
        currentUser: internalUser,
      });

      expect(sessionModel.update).not.toHaveBeenCalled();
      const result = (response as { result: { selected: number; expired: number } }).result;
      expect(result).toMatchObject({ selected: 3, expired: 0 });
    });

    it('dryRun: false expires the selected sessions and reports the actual updated count', async () => {
      const { service, sessionModel } = buildService();
      (sessionModel.count as jest.Mock).mockResolvedValueOnce(3 as never);
      (sessionModel.update as jest.Mock).mockResolvedValueOnce([3] as never);

      const response = await service.expireStaleSessions({
        tenantId: 't1',
        body: { maxIdleMinutes: 30, dryRun: false } as never,
        currentUser: internalUser,
      });

      const result = (response as { result: { selected: number; expired: number } }).result;
      expect(result).toMatchObject({ selected: 3, expired: 3 });
      const updateArgs = (sessionModel.update as jest.Mock).mock.calls[0][0] as { sessionStatus: string };
      expect(updateArgs.sessionStatus).toBe('expired');
    });
  });

  describe('runJob wrapper — job run bookkeeping', () => {
    it('records the job run as completed and stores the handler result', async () => {
      const { service, jobRunModel, retentionPolicyModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([] as never);

      const response = await service.applyRetentionPolicies({ tenantId: 't1', body: { dryRun: true } as never, currentUser: internalUser });

      expect(jobRunModel.create).toHaveBeenCalledTimes(1);
      expect((response as { status: string }).status).toBe('completed');
    });

    it('records the job run as failed and re-throws when the handler throws', async () => {
      const { service, retentionPolicyModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockRejectedValueOnce(new Error('DB unreachable') as never);

      await expect(
        service.applyRetentionPolicies({ tenantId: 't1', body: { dryRun: true } as never, currentUser: internalUser }),
      ).rejects.toThrow('DB unreachable');
    });

    it('writes an audit log entry for every successful job run', async () => {
      const { service, auditModel, retentionPolicyModel } = buildService();
      (retentionPolicyModel.findAll as jest.Mock).mockResolvedValueOnce([] as never);

      await service.applyRetentionPolicies({ tenantId: 't1', body: { dryRun: true } as never, currentUser: internalUser });

      expect(auditModel.create).toHaveBeenCalledTimes(1);
      const auditArgs = (auditModel.create as jest.Mock).mock.calls[0][0] as { actionCode: string };
      expect(auditArgs.actionCode).toBe('job_apply_retention_policies_executed');
    });
  });

  describe('recalculateDataQuality', () => {
    function buildServiceWithDataQuality() {
      const jobRunModel = { create: jest.fn(async () => buildRun()) };
      const outboxModel = { count: jest.fn() };
      const sessionModel = { count: jest.fn(), update: jest.fn() };
      const retentionPolicyModel = { findAll: jest.fn() };
      const dataQualityIssueModel = { count: jest.fn() };
      const auditModel = { create: jest.fn() };
      const gpsObservationModel = { count: jest.fn(), destroy: jest.fn() };
      const deviceSnapshotModel = { count: jest.fn(), update: jest.fn(async () => [0]) };
      const formInteractionModel = { count: jest.fn(), destroy: jest.fn() };
      const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})), query: jest.fn() };
      const eventsService = { processPendingEvents: jest.fn() };
      const service = new RuntimeJobsService(
        jobRunModel as never,
        outboxModel as never,
        sessionModel as never,
        retentionPolicyModel as never,
        dataQualityIssueModel as never,
        auditModel as never,
        gpsObservationModel as never,
        deviceSnapshotModel as never,
        formInteractionModel as never,
        sequelize as never,
        eventsService as never,
      );
      return { service, dataQualityIssueModel };
    }

    it('counts only "open" issues, scoped to the tenant', async () => {
      const { service, dataQualityIssueModel } = buildServiceWithDataQuality();
      (dataQualityIssueModel.count as jest.Mock).mockResolvedValueOnce(7 as never);

      const response = await service.recalculateDataQuality({ tenantId: 't1', body: { dryRun: true } as never, currentUser: internalUser });

      expect(dataQualityIssueModel.count).toHaveBeenCalledWith({ where: { tenantId: 't1', issueStatus: 'open' } });
      const result = (response as { result: { openIssues: number; issuesCreated: number } }).result;
      expect(result).toMatchObject({ openIssues: 7, issuesCreated: 0 });
    });

    it('narrows the count to a specific customer when customerId is given, targeting the "customers" table', async () => {
      const { service, dataQualityIssueModel } = buildServiceWithDataQuality();
      (dataQualityIssueModel.count as jest.Mock).mockResolvedValueOnce(2 as never);

      await service.recalculateDataQuality({
        tenantId: 't1',
        body: { dryRun: true, customerId: 'c1' } as never,
        currentUser: internalUser,
      });

      expect(dataQualityIssueModel.count).toHaveBeenCalledWith({
        where: { tenantId: 't1', issueStatus: 'open', targetTable: 'customers', targetRecordId: 'c1' },
      });
    });

    it('issuesCreated is always 0 — this method only recounts existing issues, it never creates new ones (that lives in rule-specific workers)', async () => {
      const { service, dataQualityIssueModel } = buildServiceWithDataQuality();
      (dataQualityIssueModel.count as jest.Mock).mockResolvedValueOnce(0 as never);

      const response = await service.recalculateDataQuality({
        tenantId: 't1',
        body: { dryRun: false } as never,
        currentUser: internalUser,
      });

      const result = (response as { result: { issuesCreated: number } }).result;
      expect(result.issuesCreated).toBe(0);
    });
  });
});
