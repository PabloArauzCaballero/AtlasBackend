import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { CatalogStagingReadService } from '../../../src/modules/catalog-management/application/catalog-staging-read.service.js';

const item = {
  id: 5,
  catalogId: 2,
  ingestionJobId: 9,
  proposedItemCode: 'BNB',
  proposedItemName: 'Banco Nacional',
  proposedAttributesJson: { pais: 'BO' },
  aiSuggested: false,
  reviewStatus: 'pending_review',
  reviewNotes: null,
};

function build(catalog: unknown = { id: 2 }) {
  const items = {
    findAndCountAll: jest.fn(async (_: unknown) => ({ rows: [item], count: 1 })),
    count: jest.fn(async (_: unknown) => 4),
  };
  const catalogs = { findOne: jest.fn(async (_: unknown) => catalog) };
  return { service: new CatalogStagingReadService(items as never, catalogs as never), items, catalogs };
}

describe('CatalogStagingReadService', () => {
  it('traduce el código de catálogo a su id y pagina, con el mismo DTO que la decisión en lote', async () => {
    const { service, items } = build();
    const page = await service.list({ catalogCode: 'bancos', reviewStatus: 'pending_review', page: 2, pageSize: 50 });
    expect((items.findAndCountAll.mock.calls[0]![0] as { where: unknown; offset: number }).where).toEqual({
      catalogId: 2,
      reviewStatus: 'pending_review',
    });
    expect((items.findAndCountAll.mock.calls[0]![0] as { offset: number }).offset).toBe(50);
    expect(page.items[0]).toMatchObject({ stagingItemId: '5', proposedItemCode: 'BNB', reviewStatus: 'pending_review' });
    // Lo de siempre sigue en su sitio y lo nuevo se añade.
    expect(page).toMatchObject({ total: 1, page: 2, pageSize: 50 });
    expect(page.meta).toEqual({ page: 2, limit: 50, total: 1, totalPages: 1 });
  });

  it('`limit` manda sobre `pageSize`; q y «sugerido por IA» viajan al servidor y el resumen es del alcance, no del filtro', async () => {
    const { service, items } = build();
    const page = await service.list({
      catalogCode: 'bancos',
      ingestionJobId: '9',
      q: 'banco_',
      aiSuggested: true,
      page: 3,
      pageSize: 50,
      limit: 20,
    });

    const consulta = items.findAndCountAll.mock.calls[0]![0] as { where: Record<string | symbol, unknown>; limit: number; offset: number };
    expect({ limit: consulta.limit, offset: consulta.offset }).toEqual({ limit: 20, offset: 40 });
    expect(consulta.where).toMatchObject({ catalogId: 2, ingestionJobId: '9', aiSuggested: true });
    expect(Object.getOwnPropertySymbols(consulta.where)).toHaveLength(1);
    expect(page.pageSize).toBe(20);
    // Cada conteo del resumen lleva el alcance (catálogo e ingesta) y NUNCA el buscador ni el filtro de IA.
    for (const [argumento] of items.count.mock.calls) {
      const donde = (argumento as { where: Record<string | symbol, unknown> }).where;
      expect(donde).toMatchObject({ catalogId: 2, ingestionJobId: '9' });
      expect(Object.getOwnPropertySymbols(donde)).toHaveLength(0);
    }
    expect(page.summary).toEqual({ total: 4, pendingReview: 4, approved: 4, rejected: 4, aiSuggested: 4 });
  });

  it('un catálogo que no existe es 404, no una lista vacía que parezca «nada pendiente»', async () => {
    await expect(build(null).service.list({ catalogCode: 'nada', page: 1, pageSize: 50 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
