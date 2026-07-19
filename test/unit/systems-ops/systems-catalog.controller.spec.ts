import { describe, expect, it, jest } from '@jest/globals';
import { SystemsCatalogController } from '../../../src/modules/systems-ops/systems-catalog.controller.js';

/**
 * `SystemsCatalogController` reparte entre `SystemsCatalogQueryService` (catálogo) y los dos motores
 * de inferencia (tools / data-impacts). Spec directo que verifica el ruteo de las inferencias y una
 * muestra representativa de las lecturas del catálogo (incluida la ruta con 2 params).
 */
describe('SystemsCatalogController', () => {
  function build() {
    const service = {
      getDashboard: jest.fn(async () => ({ counts: {} })),
      listEndpoints: jest.fn(async () => ({ items: [] })),
      getEndpoint: jest.fn(async () => ({ endpoint: {} })),
      getImpactByTable: jest.fn(async () => ({ entity: {} })),
      getToolsHealth: jest.fn(async () => []),
    };
    const toolInferenceService = { infer: jest.fn(async () => ({ inferred: 1 })) };
    const dataImpactInferenceService = { infer: jest.fn(async () => ({ inferred: 2 })) };
    return {
      controller: new SystemsCatalogController(service as never, toolInferenceService as never, dataImpactInferenceService as never),
      service,
      toolInferenceService,
      dataImpactInferenceService,
    };
  }

  it('las inferencias rutean a su motor propio (no al catálogo)', async () => {
    const { controller, toolInferenceService, dataImpactInferenceService } = build();
    await controller.inferToolRequirements({ persist: true } as never);
    await controller.inferDataImpacts({ persist: false } as never);
    expect(toolInferenceService.infer).toHaveBeenCalledWith({ persist: true });
    expect(dataImpactInferenceService.infer).toHaveBeenCalledWith({ persist: false });
  });

  it('las lecturas del catálogo delegan en SystemsCatalogQueryService', async () => {
    const { controller, service } = build();
    await controller.getDashboard();
    await controller.listEndpoints({ module: 'auth' } as never);
    await controller.getEndpoint({ endpointId: '3' } as never);
    await controller.getImpactByTable({ schemaName: 's', tableName: 't' } as never);
    await controller.getToolsHealth();
    expect(service.getDashboard).toHaveBeenCalledTimes(1);
    expect(service.listEndpoints).toHaveBeenCalledWith({ module: 'auth' });
    expect(service.getEndpoint).toHaveBeenCalledWith('3');
    expect(service.getImpactByTable).toHaveBeenCalledWith('s', 't');
    expect(service.getToolsHealth).toHaveBeenCalledTimes(1);
  });
});
