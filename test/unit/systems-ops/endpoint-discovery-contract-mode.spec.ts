import { ServiceUnavailableException } from '@nestjs/common';
import { EndpointDiscoveryService } from '../../../src/modules/systems-ops/endpoint-discovery.service.js';

/**
 * El botón «Descubrir endpoints» en modo OPENAPI_CONTRACT no puede pisar el gobierno de las rutas ya revisadas.
 * Antes hacía `upsertEndpoint` sobre todas (revisión → NEEDS_REVIEW, dueño → systems); ahora va por la puesta al
 * día automática, que sólo refresca lo estructural de lo que existe.
 */
function servicio(over: { syncSelf?: jest.Mock; catalogFromContract?: jest.Mock; upsertEndpoint?: jest.Mock } = {}) {
  const repository = { upsertEndpoint: over.upsertEndpoint ?? jest.fn() };
  const openApiCatalog = {
    catalogFromContract: over.catalogFromContract ?? jest.fn(async () => ({ discovered: 3, persisted: 0, withContract: 1 })),
  };
  const autoSync = {
    syncSelf:
      over.syncSelf ??
      jest.fn(async () => ({ systemCode: 'ATLAS_BACKEND', status: 'OK', message: 'ok', endpointsImported: 568, dataEntitiesImported: 0 })),
  };
  return {
    service: new EndpointDiscoveryService(repository as never, {} as never, openApiCatalog as never, autoSync as never),
    repository,
    openApiCatalog,
    autoSync,
  };
}

describe('EndpointDiscoveryService.discover en modo OPENAPI_CONTRACT', () => {
  it('al persistir usa la puesta al día que no toca revisión ni dueño, y nunca el upsert completo', async () => {
    const { service, repository, openApiCatalog, autoSync } = servicio();

    await expect(service.discover('OPENAPI_CONTRACT', true)).resolves.toEqual({ discovered: 568, persisted: 568 });
    expect(autoSync.syncSelf).toHaveBeenCalledTimes(1);
    expect(repository.upsertEndpoint).not.toHaveBeenCalled();
    expect(openApiCatalog.catalogFromContract).not.toHaveBeenCalledWith(true);
  });

  it('sin persistir sólo previsualiza el contrato', async () => {
    const { service, autoSync, openApiCatalog } = servicio();

    await expect(service.discover('OPENAPI_CONTRACT', false)).resolves.toMatchObject({ discovered: 3, persisted: 0 });
    expect(openApiCatalog.catalogFromContract).toHaveBeenCalledWith(false);
    expect(autoSync.syncSelf).not.toHaveBeenCalled();
  });

  it('si la puesta al día no pudo leer el contrato, el botón responde 503 con el motivo, no «0 endpoints»', async () => {
    const syncSelf = jest.fn(async () => ({ systemCode: 'ATLAS_BACKEND', status: 'ERROR', message: 'sin contrato', endpointsImported: 0 }));
    const { service } = servicio({ syncSelf });

    await expect(service.discover('OPENAPI_CONTRACT', true)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
