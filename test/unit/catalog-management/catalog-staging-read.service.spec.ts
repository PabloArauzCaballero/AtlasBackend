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
  const items = { findAndCountAll: jest.fn(async (_: unknown) => ({ rows: [item], count: 1 })) };
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
  });

  it('un catálogo que no existe es 404, no una lista vacía que parezca «nada pendiente»', async () => {
    await expect(build(null).service.list({ catalogCode: 'nada', page: 1, pageSize: 50 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
