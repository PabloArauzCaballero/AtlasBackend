import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemsDataImpactInferenceService } from '../../../src/modules/systems-ops/systems-data-impact-inference.service.js';
import { SystemsToolInferenceService } from '../../../src/modules/systems-ops/systems-tool-inference.service.js';
import { assertSourceTreeAvailable } from '../../../src/modules/systems-ops/systems-source-scan.util.js';

/**
 * En la imagen desplegada no hay `src/modules`: las inferencias por código fuente respondían «0 inferidos» como un
 * resultado. Ahora fallan con 503 antes de tocar la base.
 */
describe('inferencias por código fuente sin código fuente', () => {
  let cwd: jest.SpyInstance;
  beforeEach(() => {
    cwd = jest.spyOn(process, 'cwd').mockReturnValue(mkdtempSync(join(tmpdir(), 'sin-fuente-')));
  });
  afterEach(() => cwd.mockRestore());

  it('la guarda falla con 503 y dice que no se midió', async () => {
    await expect(assertSourceTreeAvailable('Inferir X')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(assertSourceTreeAvailable('Inferir X')).rejects.toThrow(/no es que no haya nada/);
  });

  it('inferir impactos no lee la base ni devuelve cero: 503', async () => {
    const repository = { listActiveEndpoints: jest.fn(), listEntitiesWithModel: jest.fn(), listRelationships: jest.fn() };
    const service = new SystemsDataImpactInferenceService(repository as never);
    await expect(service.infer({ persist: true })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.listActiveEndpoints).not.toHaveBeenCalled();
  });

  it('inferir herramientas tampoco: 503', async () => {
    const repository = { listActiveEndpoints: jest.fn(), listTools: jest.fn() };
    const service = new SystemsToolInferenceService(repository as never);
    await expect(service.infer({ persist: true })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.listActiveEndpoints).not.toHaveBeenCalled();
  });

  it('con el árbol de fuentes presente, la guarda deja pasar', async () => {
    cwd.mockRestore();
    await expect(assertSourceTreeAvailable('Inferir X')).resolves.toBeUndefined();
    cwd = jest.spyOn(process, 'cwd');
  });
});
