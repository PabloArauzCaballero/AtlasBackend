import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataQualityService } from '../../../src/modules/data-quality/data-quality.service.js';

/**
 * `DataQualityService`: `listIssues` resuelve severity/issueCode desde data_quality_rules; `resolveIssue`
 * corre en transacción con guardas (NotFound / already-resolved) y escribe issue + audit + data-change.
 */
describe('DataQualityService', () => {
  function buildService() {
    const repository = {
      findIssues: jest.fn(),
      findRulesByIds: jest.fn(),
      findIssueById: jest.fn(),
      resolveIssue: jest.fn(async (..._args: unknown[]) => undefined),
      createAudit: jest.fn(async (..._args: unknown[]) => undefined),
      createDataChange: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const sequelize = { transaction: jest.fn(async (cb: (tx: string) => unknown) => cb('tx')) };
    const service = new DataQualityService(repository as never, sequelize as never);
    return { service, repository };
  }

  const resolveInput = {
    tenantId: 't1',
    params: { issueId: '7' },
    body: { resolution: 'resolved', reasonCode: 'fixed', notes: 'ok' },
    currentUser: { role: 'compliance_analyst', internalUserId: 'u1' },
    idempotencyKey: 'idem',
  } as never;

  it('resolves severity and issueCode from the joined data_quality_rules row, not from issueStatus', async () => {
    const { service, repository } = buildService();
    (repository.findIssues as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: '1',
          qualityRuleId: 'rule-1',
          targetTable: 'customers',
          targetRecordId: 'c1',
          issueStatus: 'open',
          detectedAt: new Date('2026-01-01T00:00:00.000Z'),
          resolvedAt: null,
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
      countsByStatus: [{ status: 'open', count: 1 }],
    } as never);
    (repository.findRulesByIds as jest.Mock).mockResolvedValueOnce([
      { id: 'rule-1', severity: 'critical', ruleCode: 'missing_identity_doc' },
    ] as never);

    const result = await service.listIssues('t1', {} as never);

    expect(repository.findRulesByIds).toHaveBeenCalledWith(['rule-1']);
    // En mayúsculas, como las opciones del filtro del portal.
    expect(result.items[0]).toMatchObject({ severity: 'CRITICAL', issueCode: 'missing_identity_doc', status: 'open' });
  });

  it('returns severity/issueCode null when the issue has no linked rule, instead of throwing', async () => {
    const { service, repository } = buildService();
    (repository.findIssues as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: '1',
          qualityRuleId: null,
          targetTable: 'customers',
          targetRecordId: 'c1',
          issueStatus: 'open',
          detectedAt: new Date('2026-01-01T00:00:00.000Z'),
          resolvedAt: null,
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
      countsByStatus: [{ status: 'open', count: 1 }],
    } as never);
    (repository.findRulesByIds as jest.Mock).mockResolvedValueOnce([] as never);

    const result = await service.listIssues('t1', {} as never);

    expect(repository.findRulesByIds).toHaveBeenCalledWith([]);
    expect(result.items[0]).toMatchObject({ severity: null, issueCode: null });
  });

  it('summary cuenta el filtro entero: pendientes = sin revisar + reconocidas; cerradas = resolved/ignored/closed', async () => {
    const { service, repository } = buildService();
    (repository.findIssues as jest.Mock).mockResolvedValueOnce({
      rows: [],
      meta: { page: 1, limit: 20, total: 10 },
      countsByStatus: [
        { status: 'open', count: 4 },
        { status: 'acknowledged', count: 3 },
        { status: 'resolved', count: 2 },
        { status: 'ignored', count: 1 },
      ],
    } as never);
    (repository.findRulesByIds as jest.Mock).mockResolvedValueOnce([] as never);
    const result = await service.listIssues('t1', {} as never);
    expect(result.summary).toEqual({
      total: 10,
      pending: 7,
      unreviewed: 4,
      acknowledged: 3,
      closed: 3,
      byStatus: { open: 4, acknowledged: 3, resolved: 2, ignored: 1 },
    });
  });

  it('una incidencia reconocida por el antiguo «Reconocer» (con resolved_at) no se publica como resuelta', async () => {
    const { service, repository } = buildService();
    (repository.findIssues as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: '2',
          qualityRuleId: null,
          targetTable: 'customers',
          targetRecordId: 'c1',
          issueStatus: 'acknowledged',
          detectedAt: new Date('2026-01-01T00:00:00.000Z'),
          resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
          resolutionNotes: ' | Acknowledged from internal portal.',
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
      countsByStatus: [{ status: 'acknowledged', count: 1 }],
    } as never);
    (repository.findRulesByIds as jest.Mock).mockResolvedValueOnce([] as never);
    const result = await service.listIssues('t1', {} as never);
    expect(result.items[0]).toMatchObject({ status: 'acknowledged', resolvedAt: null });
  });

  describe('resolveIssue', () => {
    it('lee la incidencia DENTRO de la transacción para poder bloquearla', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue(null as never);
      await expect(
        service.resolveIssue({ tenantId: 't1', params: { issueId: '7' }, body: {}, currentUser: {}, idempotencyKey: 'k' } as never),
      ).rejects.toThrow();
      expect(repository.findIssueById).toHaveBeenCalledWith('t1', '7', { transaction: 'tx' });
    });

    it('lanza NotFound si el issue no existe', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue(null as never);
      await expect(service.resolveIssue(resolveInput)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza Conflict si el issue ya está resuelto', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({ id: '7', issueStatus: 'resolved', resolvedAt: new Date() } as never);
      await expect(service.resolveIssue(resolveInput)).rejects.toBeInstanceOf(ConflictException);
    });

    it('lanza Conflict si el issue fue descartado (ignored), aunque no tenga fecha', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({ id: '7', issueStatus: 'ignored', resolvedAt: null } as never);
      await expect(service.resolveIssue(resolveInput)).rejects.toBeInstanceOf(ConflictException);
    });

    const acknowledgeInput = {
      ...(resolveInput as object),
      body: { resolution: 'acknowledged', reasonCode: 'temporary_exception', notes: 'Pendiente del proveedor' },
    } as never;

    it('reconocer deja la incidencia pendiente (sin resolved_at), con motivo en notas y auditoría propia', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({ id: '7', issueStatus: 'open', resolvedAt: null } as never);
      const res = await service.resolveIssue(acknowledgeInput);
      expect(res).toEqual({ issueId: '7', status: 'acknowledged' });
      expect((repository.resolveIssue as jest.Mock).mock.calls[0][1]).toEqual({
        status: 'acknowledged',
        notes: 'temporary_exception: Pendiente del proveedor',
        resolvedAt: null,
      });
      expect((repository.createAudit as jest.Mock).mock.calls[0][0]).toMatchObject({ actionCode: 'data_quality.issue.acknowledge' });
      expect((repository.createDataChange as jest.Mock).mock.calls[0][0]).toMatchObject({ changeType: 'acknowledge' });
    });

    it('reconocer otra vez es idempotente: no escribe ni duplica la nota', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({
        id: '7',
        issueStatus: 'acknowledged',
        resolvedAt: null,
        resolutionNotes: 'temporary_exception: Pendiente del proveedor',
      } as never);
      const res = await service.resolveIssue(acknowledgeInput);
      expect(res).toEqual({ issueId: '7', status: 'acknowledged' });
      expect(repository.resolveIssue).not.toHaveBeenCalled();
      expect(repository.createAudit).not.toHaveBeenCalled();
    });

    it('una reconocida (incluso por el antiguo endpoint, con resolved_at) se puede cerrar después: antes daba 409', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({
        id: '7',
        issueStatus: 'acknowledged',
        resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
        resolutionNotes: 'temporary_exception: Pendiente',
      } as never);
      const res = await service.resolveIssue(resolveInput);
      expect(res).toEqual({ issueId: '7', status: 'resolved' });
      const values = (repository.resolveIssue as jest.Mock).mock.calls[0][1] as { notes: string; resolvedAt: Date };
      expect(values.notes).toBe('temporary_exception: Pendiente\nfixed: ok');
      expect(values.resolvedAt).toBeInstanceOf(Date);
    });

    it('(feliz) resuelve el issue y escribe audit + data-change en la transacción', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({ id: '7', resolvedAt: null } as never);
      const res = await service.resolveIssue(resolveInput);
      expect(res).toEqual({ issueId: '7', status: 'resolved' });
      expect(repository.resolveIssue).toHaveBeenCalledTimes(1);
      expect(repository.createAudit).toHaveBeenCalledTimes(1);
      expect(repository.createDataChange).toHaveBeenCalledTimes(1);
      // las notas combinan reasonCode + notes
      expect((repository.resolveIssue as jest.Mock).mock.calls[0][1]).toMatchObject({ status: 'resolved', notes: 'fixed: ok' });
    });
  });
});
