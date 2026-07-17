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
    const make = () => ({ findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() });
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
});
