import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { POLICY_BLOCK_CODE_PATTERNS } from '../../../src/modules/external-data/provider-request-count.filter.js';
import { ExternalProviderRequestRepository } from '../../../src/modules/external-data/infrastructure/external-provider-request.repository.js';

/**
 * Cobertura directa de `ExternalProviderRequestRepository`: solicitudes, respuestas y las consultas con ramas condicionales (reuso de cache, filtros de rango, conteo por cuota). Modelos Sequelize mockeados.
 */
describe('ExternalProviderRequestRepository', () => {
  function buildRepo() {
    const make = () => ({
      findOne: asyncMock(),
      findAll: asyncMock(),
      findByPk: asyncMock(),
      create: asyncMock(),
      update: asyncMock(),
      count: asyncMock(),
      bulkCreate: asyncMock(),
    });
    const models = {
      dataProviderRequest: make(),
      dataProviderResponse: make(),
    };
    const repo = new ExternalProviderRequestRepository(models.dataProviderRequest as never, models.dataProviderResponse as never);
    return { repo, models };
  }

  it('findIdempotentProviderRequest busca por tenant + idempotencyKey', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findIdempotentProviderRequest('t1', 'idem-1');
    expect((models.dataProviderRequest.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', idempotencyKey: 'idem-1' },
    });
  });

  describe('findReusableProviderRequest (cache hit)', () => {
    it('exige estados exitosos y una ventana temporal, y añade customerId solo si viene', async () => {
      const { repo, models } = buildRepo();
      (models.dataProviderRequest.findOne as jest.Mock).mockResolvedValue(null as never);
      const since = new Date('2026-01-01');

      await repo.findReusableProviderRequest({ tenantId: 't1', providerId: 'p1', queryType: 'q', requestPayloadHash: 'h', since });
      let where = callArg<CallArgRecord>(models.dataProviderRequest.findOne, 0, 0).where as Record<string, unknown>;
      expect(where).toMatchObject({ tenantId: 't1', providerId: 'p1', requestType: 'q', requestPayloadHash: 'h' });
      expect(where.responseStatus).toBeDefined(); // { [Op.in]: [COMPLETED, MOCKED, DATA_NOT_AVAILABLE] }
      expect(where.customerId).toBeUndefined();

      await repo.findReusableProviderRequest({
        tenantId: 't1',
        providerId: 'p1',
        customerId: 'c1',
        queryType: 'q',
        requestPayloadHash: 'h',
        since,
      });
      where = callArg<CallArgRecord>(models.dataProviderRequest.findOne, 1, 0).where as Record<string, unknown>;
      expect(where.customerId).toBe('c1');
    });
  });

  describe('countRequests (cuotas)', () => {
    it('cuenta por proveedor desde una fecha; agrega customerId y estados si vienen', async () => {
      const { repo, models } = buildRepo();
      (models.dataProviderRequest.count as jest.Mock).mockResolvedValue(7 as never);

      const result = await repo.countRequests({
        providerId: 'p1',
        customerId: 'c1',
        from: new Date('2026-01-01'),
        statuses: ['COMPLETED'],
      });
      expect(result).toBe(7);
      const where = callArg<CallArgRecord>(models.dataProviderRequest.count, 0, 0).where as Record<string, unknown>;
      expect(where).toMatchObject({ providerId: 'p1', customerId: 'c1' });
      expect(where.responseStatus).toBeDefined();
    });

    it('para el disyuntor deja fuera los rechazos de Atlas (cuota, disyuntor, portón), no los del proveedor', async () => {
      const { repo, models } = buildRepo();
      (models.dataProviderRequest.count as jest.Mock).mockResolvedValue(1 as never);
      await repo.countRequests({ providerId: 'p1', from: new Date('2026-01-01'), statuses: ['FAILED'], onlyProviderOutcomes: true });
      const where = callArg<CallArgRecord>(models.dataProviderRequest.count, 0, 0).where as Record<string | symbol, unknown>;
      expect(where[Op.or]).toEqual([{ responseCode: null }, { responseCode: { [Op.notLike]: { [Op.all]: POLICY_BLOCK_CODE_PATTERNS } } }]);
      expect(POLICY_BLOCK_CODE_PATTERNS).toEqual(expect.arrayContaining(['%\\_CIRCUIT\\_BREAKER\\_OPEN', '%\\_QUOTA\\_EXCEEDED']));
    });

    it('sin statuses ni customerId, solo filtra por proveedor y fecha', async () => {
      const { repo, models } = buildRepo();
      (models.dataProviderRequest.count as jest.Mock).mockResolvedValue(0 as never);
      await repo.countRequests({ providerId: 'p1', from: new Date('2026-01-01') });
      const where = callArg<CallArgRecord>(models.dataProviderRequest.count, 0, 0).where as Record<string, unknown>;
      expect(where.customerId).toBeUndefined();
      expect(where.responseStatus).toBeUndefined();
    });
  });

  it('listProviderRequests aplica un rango [from, to) cuando se da `to`', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listProviderRequests({ from: new Date('2026-01-01'), to: new Date('2026-02-01'), tenantId: 't1' });
    const where = callArg<CallArgRecord>(models.dataProviderRequest.findAll, 0, 0).where as Record<string, { [k: symbol]: unknown }>;
    // requestedAt debe tener ambos límites (gte + lt) cuando hay `to`.
    expect(Object.getOwnPropertySymbols(where.requestedAt).length).toBe(2);
  });

  it('listIdempotencyAuditRequests exige idempotencyKey no nula', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listIdempotencyAuditRequests({ from: new Date('2026-01-01') });
    const where = callArg<CallArgRecord>(models.dataProviderRequest.findAll, 0, 0).where as Record<string, unknown>;
    expect(where.idempotencyKey).toBeDefined(); // { [Op.ne]: null }
  });

  it('createProviderRequest y createProviderResponse crean con defaults null', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.create as jest.Mock).mockResolvedValue({ id: 'req1' } as never);
    await repo.createProviderRequest({
      tenantId: 't1',
      providerId: 'p1',
      requestType: 'q',
      purposeCode: 'pc',
      decisionStage: 's',
      modeUsed: 'local',
      requestPayloadHash: 'h',
      responseStatus: 'COMPLETED',
      now: new Date(),
    } as never);
    expect((models.dataProviderRequest.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      customerId: null,
      idempotencyKey: null,
      respondedAt: null,
    });

    (models.dataProviderResponse.create as jest.Mock).mockResolvedValue({ id: 'res1' } as never);
    await repo.createProviderResponse({
      tenantId: 't1',
      providerRequestId: 'req1',
      redactedPayloadJson: {},
      normalizedPayloadJson: {},
      responseHash: 'h',
      containsSensitiveData: false,
      now: new Date(),
    });
    expect((models.dataProviderResponse.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      payloadStorageStrategy: 'inline_redacted',
      providerStatusCode: null,
    });
  });

  it('updateProviderRequest aplica el patch con fallback a los valores existentes del request', async () => {
    const { repo } = buildRepo();
    const request = {
      responseCode: 'old',
      latencyMs: 100,
      respondedAt: null,
      providerRequestRef: 'ref',
      actualCostAmount: null,
      errorMessageSafe: null,
      metadataJson: null,
      update: jest.fn(async (v: unknown) => v),
    };
    await repo.updateProviderRequest(request as never, { responseStatus: 'COMPLETED', latencyMs: 250 });
    const patch = (request.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toMatchObject({ responseStatus: 'COMPLETED', latencyMs: 250, responseCode: 'old', providerRequestRef: 'ref' });
  });

  it('finders de solicitudes y respuestas delegan con su filtro', async () => {
    const { repo, models } = buildRepo();
    for (const m of Object.values(models)) {
      (m.findAll as jest.Mock).mockResolvedValue([] as never);
      (m.findByPk as jest.Mock).mockResolvedValue(null as never);
      (m.findOne as jest.Mock).mockResolvedValue(null as never);
    }
    await repo.findProviderRequestById('r1');
    expect(models.dataProviderRequest.findByPk).toHaveBeenCalledWith('r1');
    await repo.findProviderRequestByIdAndTenant('t1', 'r1');
    expect((models.dataProviderRequest.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', id: 'r1' } });
    await repo.findProviderResponsesByRequestId('r1');
    expect((models.dataProviderResponse.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { providerRequestId: 'r1' },
      limit: 10,
    });
    await repo.findProviderResponsesByRequestIdAndTenant('t1', 'r1');
    expect((models.dataProviderResponse.findAll as jest.Mock).mock.calls[1][0]).toMatchObject({
      where: { tenantId: 't1', providerRequestId: 'r1' },
    });
    await repo.listRecentProviderResponses(7);
    expect((models.dataProviderResponse.findAll as jest.Mock).mock.calls[2][0]).toMatchObject({ where: {}, limit: 7 });
    await repo.listRecentProviderResponses(7, 't1');
    expect((models.dataProviderResponse.findAll as jest.Mock).mock.calls[3][0]).toMatchObject({ where: { tenantId: 't1' }, limit: 7 });
  });
});
