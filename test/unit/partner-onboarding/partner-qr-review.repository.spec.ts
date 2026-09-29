import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import type { PartnerBranchModel, PartnerQrCodeModel } from '../../../src/database/models/index.js';
import { PartnerQrReviewRepository } from '../../../src/modules/partner-onboarding/partner-qr-review.repository.js';

/**
 * La cola de QR de cobro por revisar. Aquí se fijan las condiciones que deciden qué entra en la cola;
 * que el SQL de la búsqueda case con las columnas y con los comercios y sucursales de otras tablas
 * lo prueba la integración contra Postgres real.
 */
type Where = Record<string | symbol, unknown>;
type Consulta = { where: Where; order?: unknown[]; limit?: number; offset?: number };

describe('PartnerQrReviewRepository', () => {
  let qrs: { findAndCountAll: jest.Mock; count: jest.Mock; min: jest.Mock };
  let branches: { findAll: jest.Mock };
  let repo: PartnerQrReviewRepository;
  const ultima = (mock: jest.Mock) => mock.mock.calls.at(-1)?.[0] as Consulta;

  beforeEach(() => {
    qrs = {
      findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
      count: jest.fn(async () => 0),
      min: jest.fn(async () => null),
    };
    branches = { findAll: jest.fn(async () => []) };
    repo = new PartnerQrReviewRepository(branches as unknown as typeof PartnerBranchModel, qrs as unknown as typeof PartnerQrCodeModel);
  });

  it('la cola es del tenant entero, el más antiguo primero y POR PÁGINAS (antes llegaba entera)', async () => {
    await repo.listQrCodesPendingReview('t1', { limit: 10, offset: 20 });

    const { where, order, limit, offset } = ultima(qrs.findAndCountAll);
    expect(where).toEqual({ tenantId: 't1', status: 'pending_review' });
    expect(order).toEqual([
      ['_created_at', 'ASC'],
      ['_id', 'ASC'],
    ]);
    expect({ limit, offset }).toEqual({ limit: 10, offset: 20 });
  });

  it('con qrKind y texto, la cola casa por sus columnas, sus comercios o sus sucursales', async () => {
    await repo.listQrCodesPendingReview('t1', {
      limit: 10,
      offset: 0,
      qrKind: 'bank',
      search: { q: 'sur', partnerIds: ['7'], branchIds: [] },
    });

    const { where } = ultima(qrs.findAndCountAll);
    expect(where).toMatchObject({ tenantId: 't1', status: 'pending_review', qrKind: 'bank' });
    const [busqueda] = where[Op.and] as Array<Record<symbol, unknown[]>>;
    // 3 columnas del QR + 2 ids como texto + los comercios; sin sucursales no se añade la condición vacía.
    expect(busqueda![Op.or]).toHaveLength(6);
  });

  it('con sucursales que casan se añaden también a la condición', async () => {
    await repo.listQrCodesPendingReview('t1', { limit: 10, offset: 0, search: { q: 'sur', partnerIds: [], branchIds: ['3'] } });

    const [busqueda] = ultima(qrs.findAndCountAll).where[Op.and] as Array<Record<symbol, unknown[]>>;
    expect(busqueda![Op.or]).toHaveLength(6);
  });

  it('el resumen cuenta la cola entera por tipo, sin buscador ni filtro', async () => {
    qrs.count
      .mockResolvedValueOnce(7 as never)
      .mockResolvedValueOnce(5 as never)
      .mockResolvedValueOnce(2 as never);
    qrs.min.mockResolvedValueOnce(new Date('2026-09-01T10:00:00Z') as never);

    await expect(repo.summarizeQrPendingReview('t1')).resolves.toEqual({
      total: 7,
      business: 5,
      bank: 2,
      oldestCreatedAt: new Date('2026-09-01T10:00:00Z'),
    });
    expect(qrs.count.mock.calls.map(([argumento]) => (argumento as { where: Where }).where)).toEqual([
      { tenantId: 't1', status: 'pending_review' },
      { tenantId: 't1', status: 'pending_review', qrKind: 'business' },
      { tenantId: 't1', status: 'pending_review', qrKind: 'bank' },
    ]);
  });

  it('las sucursales que casan se piden por nombre, código y ciudad, del tenant, y devuelven sólo ids', async () => {
    branches.findAll.mockResolvedValueOnce([{ id: '3' }, { id: '4' }] as never);

    await expect(repo.findBranchIdsMatching('t1', 'centro')).resolves.toEqual(['3', '4']);
    const consulta = ultima(branches.findAll) as Consulta & { attributes?: string[] };
    expect(consulta.attributes).toEqual(['id']);
    expect(consulta.where).toMatchObject({ tenantId: 't1' });
    expect(consulta.where[Op.or] as unknown[]).toHaveLength(3);
  });

  it('sin ids no se consulta: la cola de QR enseña la sucursal sólo de los que la tienen', async () => {
    await expect(repo.findBranchesByIds('t1', [])).resolves.toEqual([]);
    expect(branches.findAll).not.toHaveBeenCalled();
    await repo.findBranchesByIds('t1', ['3', '3', '4']);
    expect(ultima(branches.findAll).where).toMatchObject({ tenantId: 't1', id: { [Op.in]: ['3', '4'] } });
  });
});
