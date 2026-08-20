import { describe, expect, it, jest } from '@jest/globals';
import { SystemsErpInventoryService } from '../../../src/modules/systems-ops/systems-erp-inventory.service.js';

/**
 * Las entidades del ERP en el catálogo del portal.
 *
 * El catálogo se puebla escaneando los modelos de ESTE repositorio, así que las 95 tablas del ERP
 * —que viven en otro repositorio y otra base— no entraban nunca: el portal que existe para
 * gobernar los datos de la plataforma mostraba dos tercios de ella.
 */

type AnyRecord = Record<string, unknown>;

function build() {
  const seeds: AnyRecord[] = [];
  const repository = {
    upsertDataEntity: jest.fn(async (...args: unknown[]) => {
      seeds.push(args[0] as AnyRecord);
    }),
  };
  const service = new SystemsErpInventoryService(repository as never);
  return { service, repository, seeds };
}

describe('SystemsErpInventoryService', () => {
  it('incorpora el inventario versionado del ERP', async () => {
    const { service, seeds } = build();

    const count = await service.seedErpEntities();

    expect(count).toBeGreaterThan(0);
    expect(seeds.length).toBe(count);
  });

  /*
   * `source_system` es lo que distingue una tabla del ERP de una propia. Sin él, las dos bases se
   * muestran como si fueran una y no hay forma de saber cuál se gobierna desde aquí.
   */
  it('marca su origen y no lo confunde con el propio', async () => {
    const { service, seeds } = build();

    await service.seedErpEntities();

    expect(seeds.every((seed) => seed.sourceSystem === 'atlas-erp')).toBe(true);
  });

  /*
   * MEDIUM y no HIGH, a conciencia: de las entidades propias hay modelo, narrativa y campos; de
   * éstas se sabe lo que el inventario trae. Igualarlas haría creer que están gobernadas al mismo
   * nivel, y todavía no lo están.
   */
  it('declara confianza media, no alta', async () => {
    const { service, seeds } = build();

    await service.seedErpEntities();

    expect(seeds.every((seed) => seed.confidenceLevel === 'MEDIUM')).toBe(true);
    expect(seeds.every((seed) => seed.detectedFrom === 'erp_inventory')).toBe(true);
  });

  it('clasifica cada schema del ERP en su módulo', async () => {
    const { service, seeds } = build();

    await service.seedErpEntities();

    const contable = seeds.find((seed) => seed.schemaName === 'atlas_accounting');
    expect(contable?.module).toBe('erp_accounting');
    // Toda la contabilidad toca dinero: el schema basta para marcarlo.
    expect(contable?.containsFinancialData).toBe(true);
    expect(contable?.isAuditCritical).toBe(true);
  });

  /*
   * Sin inventario el catálogo sigue teniendo las entidades propias. Degradar la vista es malo;
   * tumbar el refresco la deja congelada, que es peor —y es justo el fallo que este catálogo
   * acababa de arreglar—.
   */
  it('sin inventario no tumba el refresco', async () => {
    const { service } = build();
    const original = process.cwd();
    process.chdir('/tmp');
    try {
      await expect(service.seedErpEntities()).resolves.toBe(0);
    } finally {
      process.chdir(original);
    }
  });
});
