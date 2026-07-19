import { describe, expect, it, jest } from '@jest/globals';
import { ExternalDataRepository } from '../../../src/modules/external-data/external-data.repository.js';

/**
 * Cobertura directa de `ExternalDataRepository` (Fase 1.2 del plan 10/10): finders de proveedores,
 * requests y responses, y las consultas con ramas condicionales (reuso de cache, filtros de rango,
 * conteo por cuota). El servicio lo mockea, así que su capa de lectura no se ejercitaba. Modelos
 * Sequelize mockeados.
 */
describe('ExternalDataRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), bulkCreate: jest.fn() });
    const models = {
      dataProvider: make(),
      costPolicy: make(),
      customerConsent: make(),
      dataProviderRequest: make(),
      dataProviderResponse: make(),
      customerObservation: make(),
      featureSnapshot: make(),
      providerHealthLog: make(),
    };
    const repo = new ExternalDataRepository(
      models.dataProvider as never,
      models.costPolicy as never,
      models.customerConsent as never,
      models.dataProviderRequest as never,
      models.dataProviderResponse as never,
      models.customerObservation as never,
      models.featureSnapshot as never,
      models.providerHealthLog as never,
    );
    return { repo, models };
  }

  it('findProviderByCode / findProviderById / findCostPolicy filtran por sus claves', async () => {
    const { repo, models } = buildRepo();
    (models.dataProvider.findOne as jest.Mock).mockResolvedValue({ id: 'p1' } as never);
    (models.dataProvider.findByPk as jest.Mock).mockResolvedValue({ id: 'p1' } as never);
    (models.costPolicy.findOne as jest.Mock).mockResolvedValue(null as never);

    await repo.findProviderByCode('INFOCENTER');
    await repo.findProviderById('p1');
    await repo.findCostPolicy('p1', 'credit_check');

    expect((models.dataProvider.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { providerCode: 'INFOCENTER' } });
    expect(models.dataProvider.findByPk).toHaveBeenCalledWith('p1');
    // findCostPolicy solo devuelve la política ACTIVA.
    expect((models.costPolicy.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { providerId: 'p1', queryType: 'credit_check', active: true } });
  });

  it('findIdempotentProviderRequest busca por tenant + idempotencyKey', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findIdempotentProviderRequest('t1', 'idem-1');
    expect((models.dataProviderRequest.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', idempotencyKey: 'idem-1' } });
  });

  describe('findReusableProviderRequest (cache hit)', () => {
    it('exige estados exitosos y una ventana temporal, y añade customerId solo si viene', async () => {
      const { repo, models } = buildRepo();
      (models.dataProviderRequest.findOne as jest.Mock).mockResolvedValue(null as never);
      const since = new Date('2026-01-01');

      await repo.findReusableProviderRequest({ tenantId: 't1', providerId: 'p1', queryType: 'q', requestPayloadHash: 'h', since });
      let where = (models.dataProviderRequest.findOne as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
      expect(where).toMatchObject({ tenantId: 't1', providerId: 'p1', requestType: 'q', requestPayloadHash: 'h' });
      expect(where.responseStatus).toBeDefined(); // { [Op.in]: [COMPLETED, MOCKED, DATA_NOT_AVAILABLE] }
      expect(where.customerId).toBeUndefined();

      await repo.findReusableProviderRequest({ tenantId: 't1', providerId: 'p1', customerId: 'c1', queryType: 'q', requestPayloadHash: 'h', since });
      where = (models.dataProviderRequest.findOne as jest.Mock).mock.calls[1][0].where as Record<string, unknown>;
      expect(where.customerId).toBe('c1');
    });
  });

  describe('countRequests (cuotas)', () => {
    it('cuenta por proveedor desde una fecha; agrega customerId y estados si vienen', async () => {
      const { repo, models } = buildRepo();
      (models.dataProviderRequest.count as jest.Mock).mockResolvedValue(7 as never);

      const result = await repo.countRequests({ providerId: 'p1', customerId: 'c1', from: new Date('2026-01-01'), statuses: ['COMPLETED'] });
      expect(result).toBe(7);
      const where = (models.dataProviderRequest.count as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
      expect(where).toMatchObject({ providerId: 'p1', customerId: 'c1' });
      expect(where.responseStatus).toBeDefined();
    });

    it('sin statuses ni customerId, solo filtra por proveedor y fecha', async () => {
      const { repo, models } = buildRepo();
      (models.dataProviderRequest.count as jest.Mock).mockResolvedValue(0 as never);
      await repo.countRequests({ providerId: 'p1', from: new Date('2026-01-01') });
      const where = (models.dataProviderRequest.count as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
      expect(where.customerId).toBeUndefined();
      expect(where.responseStatus).toBeUndefined();
    });
  });

  it('listProviderRequests aplica un rango [from, to) cuando se da `to`', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listProviderRequests({ from: new Date('2026-01-01'), to: new Date('2026-02-01'), tenantId: 't1' });
    const where = (models.dataProviderRequest.findAll as jest.Mock).mock.calls[0][0].where as Record<string, { [k: symbol]: unknown }>;
    // requestedAt debe tener ambos límites (gte + lt) cuando hay `to`.
    expect(Object.getOwnPropertySymbols(where.requestedAt).length).toBe(2);
  });

  it('listIdempotencyAuditRequests exige idempotencyKey no nula', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listIdempotencyAuditRequests({ from: new Date('2026-01-01') });
    const where = (models.dataProviderRequest.findAll as jest.Mock).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.idempotencyKey).toBeDefined(); // { [Op.ne]: null }
  });

  it('listCustomerObservations trae solo las de origen external_provider', async () => {
    const { repo, models } = buildRepo();
    (models.customerObservation.findAll as jest.Mock).mockResolvedValue([] as never);
    await repo.listCustomerObservations('t1', 'c1');
    expect((models.customerObservation.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', customerId: 'c1', sourceType: 'external_provider' },
    });
  });

  // --- Mutaciones ------------------------------------------------------------------------------

  it('updateCostPolicy devuelve null si no existe; si existe aplica solo los campos del patch', async () => {
    const missing = buildRepo();
    (missing.models.costPolicy.findOne as jest.Mock).mockResolvedValue(null as never);
    expect(await missing.repo.updateCostPolicy('p1', 'q', {})).toBeNull();

    const found = buildRepo();
    const policy = { update: jest.fn(async () => undefined) };
    (found.models.costPolicy.findOne as jest.Mock).mockResolvedValue(policy as never);
    const res = await found.repo.updateCostPolicy('p1', 'q', { unitCostAmount: 1.5, currency: 'BOB', active: false });
    expect(res).toBe(policy);
    const update = (policy.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(update).toMatchObject({ unitCostAmount: '1.5000', currency: 'BOB', active: false });
    expect(update.costTier).toBeUndefined(); // no venía en el patch
  });

  it('updateProviderRuntime devuelve null si no existe; si existe aplica el patch', async () => {
    const missing = buildRepo();
    (missing.models.dataProvider.findByPk as jest.Mock).mockResolvedValue(null as never);
    expect(await missing.repo.updateProviderRuntime('p1', {})).toBeNull();

    const found = buildRepo();
    const provider = { update: jest.fn(async () => undefined) };
    (found.models.dataProvider.findByPk as jest.Mock).mockResolvedValue(provider as never);
    await found.repo.updateProviderRuntime('p1', { providerStatus: 'DEGRADED', isActive: false });
    expect((provider.update as jest.Mock).mock.calls[0][0]).toMatchObject({ providerStatus: 'DEGRADED', isActive: false });
  });

  it('revokeCustomerConsent devuelve null si no existe; si existe marca granted=false y revokedAt', async () => {
    const missing = buildRepo();
    (missing.models.customerConsent.findOne as jest.Mock).mockResolvedValue(null as never);
    expect(await missing.repo.revokeCustomerConsent('t1', 'c1', new Date())).toBeNull();

    const found = buildRepo();
    const consent = { update: jest.fn(async () => undefined) };
    (found.models.customerConsent.findOne as jest.Mock).mockResolvedValue(consent as never);
    const now = new Date('2026-01-01');
    await found.repo.revokeCustomerConsent('t1', 'c1', now);
    expect((consent.update as jest.Mock).mock.calls[0][0]).toMatchObject({ granted: false, revokedAt: now });
  });

  it('createProviderRequest y createProviderResponse crean con defaults null', async () => {
    const { repo, models } = buildRepo();
    (models.dataProviderRequest.create as jest.Mock).mockResolvedValue({ id: 'req1' } as never);
    await repo.createProviderRequest({ tenantId: 't1', providerId: 'p1', requestType: 'q', purposeCode: 'pc', decisionStage: 's', modeUsed: 'local', requestPayloadHash: 'h', responseStatus: 'COMPLETED', now: new Date() } as never);
    expect((models.dataProviderRequest.create as jest.Mock).mock.calls[0][0]).toMatchObject({ customerId: null, idempotencyKey: null, respondedAt: null });

    (models.dataProviderResponse.create as jest.Mock).mockResolvedValue({ id: 'res1' } as never);
    await repo.createProviderResponse({ tenantId: 't1', providerRequestId: 'req1', redactedPayloadJson: {}, normalizedPayloadJson: {}, responseHash: 'h', containsSensitiveData: false, now: new Date() });
    expect((models.dataProviderResponse.create as jest.Mock).mock.calls[0][0]).toMatchObject({ payloadStorageStrategy: 'inline_redacted', providerStatusCode: null });
  });

  it('updateProviderRequest aplica el patch con fallback a los valores existentes del request', async () => {
    const { repo } = buildRepo();
    const request = { responseCode: 'old', latencyMs: 100, respondedAt: null, providerRequestRef: 'ref', actualCostAmount: null, errorMessageSafe: null, metadataJson: null, update: jest.fn(async (v: unknown) => v) };
    await repo.updateProviderRequest(request as never, { responseStatus: 'COMPLETED', latencyMs: 250 });
    const patch = (request.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toMatchObject({ responseStatus: 'COMPLETED', latencyMs: 250, responseCode: 'old', providerRequestRef: 'ref' });
  });

  it('createObservations corta con lista vacía y mapea valueType + verificationStatus', async () => {
    const empty = buildRepo();
    await empty.repo.createObservations({ tenantId: 't1', customerId: 'c1', providerId: 'p1', requestId: 'r1', observations: [], now: new Date() });
    expect(empty.models.customerObservation.bulkCreate).not.toHaveBeenCalled();

    const { repo, models } = buildRepo();
    await repo.createObservations({
      tenantId: 't1',
      customerId: 'c1',
      providerId: 'p1',
      requestId: 'r1',
      observations: [
        { observationKey: 'a', valueType: 'NUMBER', valueNumber: 0.5, confidenceScore: 0.9, verified: true } as never,
        { observationKey: 'b', valueType: 'STRING', valueString: 'x', verified: false, manualReviewRequired: true } as never,
        { observationKey: 'c', valueType: 'BOOLEAN', valueBoolean: true, verified: false, manualReviewRequired: false } as never,
      ],
      now: new Date(),
    });
    const rows = (models.customerObservation.bulkCreate as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ valueNumber: '0.5000', confidenceScore: '90.00', verificationStatus: 'verified' });
    expect(rows[1]).toMatchObject({ valueText: 'x', verificationStatus: 'manual_review_required' });
    expect(rows[2]).toMatchObject({ valueBoolean: true, verificationStatus: 'unverified' });
  });

  it('createFeatureSnapshot y createHealthLog crean con sus campos derivados', async () => {
    const { repo, models } = buildRepo();
    (models.featureSnapshot.create as jest.Mock).mockResolvedValue({ id: 'fs1' } as never);
    await repo.createFeatureSnapshot({ tenantId: 't1', customerId: 'c1', providerCode: 'SEGIP', requestId: 'r1', featuresJson: {}, missingFeaturesJson: {}, integrityHash: 'h', now: new Date() });
    expect((models.featureSnapshot.create as jest.Mock).mock.calls[0][0]).toMatchObject({ snapshotReason: 'external_provider_segip', triggeringEntityId: 'r1' });

    (models.providerHealthLog.create as jest.Mock).mockResolvedValue({ id: 'h1' } as never);
    await repo.createHealthLog({ providerId: 'p1', health: { providerCode: 'SEGIP', status: 'UP', mode: 'local', latencyMs: 5, checkedAt: '2026-01-01T00:00:00.000Z' } as never });
    expect((models.providerHealthLog.create as jest.Mock).mock.calls[0][0]).toMatchObject({ status: 'UP', errorCode: null, metadataJson: { providerCode: 'SEGIP' } });
  });

  it('finders de listado (providers/requests/responses/cost-policies/feature-snapshots) delegan con su filtro', async () => {
    const { repo, models } = buildRepo();
    for (const m of Object.values(models)) {
      (m.findAll as jest.Mock).mockResolvedValue([] as never);
      (m.findByPk as jest.Mock).mockResolvedValue(null as never);
      (m.findOne as jest.Mock).mockResolvedValue(null as never);
    }
    await repo.listProviders();
    expect((models.dataProvider.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ order: [['provider_code', 'ASC']] });
    await repo.findProviderRequestById('r1');
    expect(models.dataProviderRequest.findByPk).toHaveBeenCalledWith('r1');
    await repo.findProviderRequestByIdAndTenant('t1', 'r1');
    expect((models.dataProviderRequest.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', id: 'r1' } });
    await repo.findProviderResponsesByRequestId('r1');
    expect((models.dataProviderResponse.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { providerRequestId: 'r1' }, limit: 10 });
    await repo.findProviderResponsesByRequestIdAndTenant('t1', 'r1');
    expect((models.dataProviderResponse.findAll as jest.Mock).mock.calls[1][0]).toMatchObject({ where: { tenantId: 't1', providerRequestId: 'r1' } });
    await repo.listRecentProviderResponses(7);
    expect((models.dataProviderResponse.findAll as jest.Mock).mock.calls[2][0]).toMatchObject({ limit: 7 });
    await repo.listCustomerFeatureSnapshots('t1', 'c1');
    expect((models.featureSnapshot.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', customerId: 'c1', triggeringEntityType: 'data_provider_request' } });
    await repo.listCostPolicies('p1');
    expect((models.costPolicy.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { providerId: 'p1' } });
  });

  it('consentimientos: findCustomerConsent (granted+no-revocado), byId, list y create', async () => {
    const { repo, models } = buildRepo();
    (models.customerConsent.findOne as jest.Mock).mockResolvedValue(null as never);
    (models.customerConsent.findAll as jest.Mock).mockResolvedValue([] as never);
    (models.customerConsent.create as jest.Mock).mockResolvedValue({ id: 'k1' } as never);

    await repo.findCustomerConsent('t1', 'c1', ['KYC_SEGIP']);
    expect((models.customerConsent.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', customerId: 'c1', granted: true, revokedAt: null } });
    await repo.findCustomerConsentByIdAndTenant('t1', 'k9');
    expect((models.customerConsent.findOne as jest.Mock).mock.calls[1][0]).toMatchObject({ where: { tenantId: 't1', id: 'k9' } });
    await repo.listCustomerConsents('t1', 'c1');
    expect((models.customerConsent.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', customerId: 'c1' }, limit: 100 });
    await repo.createCustomerConsent({ tenantId: 't1', customerId: 'c1', purposeCode: 'KYC_SEGIP', channel: 'web', now: new Date() });
    expect((models.customerConsent.create as jest.Mock).mock.calls[0][0]).toMatchObject({ purposeCode: 'KYC_SEGIP', granted: true, consentDocumentId: null, channel: 'web' });
  });
});
