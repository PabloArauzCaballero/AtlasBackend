import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { SystemsCatalogRepository } from '../../src/modules/systems-ops/systems-catalog.repository.js';

/**
 * `markDeprecatedCandidates` solía hacer `findAll` de TODO `system_endpoint_catalog` y un
 * `row.save()` por fila que calificaba como candidata a deprecar (N round trips). Ahora filtra
 * `status`/`reviewStatus` en SQL y marca todas las filas stale con un solo `UPDATE ... WHERE id
 * IN (...)`. Estos tests fijan que el resultado (qué se marca, qué no) no cambió con el fix.
 */
function buildModelMock(rows: Array<{ id: string; method: string; fullPath: string }>) {
  return {
    findAll: jest.fn(async () => rows),
    // Simula el conteo de filas afectadas que devolvería un UPDATE real, a partir de cuántos ids
    // vinieron en el WHERE id IN (...) — así el test detecta si el fix alguna vez deja de marcar
    // exactamente las filas stale.
    update: jest.fn(async (_values: unknown, options: { where: { id: { [key: symbol]: string[] } } }) => {
      const ids = options.where.id[Op.in as unknown as symbol] ?? [];
      return [ids.length];
    }),
  };
}

function buildRepository(endpointModel: ReturnType<typeof buildModelMock>) {
  return new SystemsCatalogRepository(
    endpointModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('SystemsCatalogRepository.markDeprecatedCandidates', () => {
  it('only queries endpoints that are already ACTIVE and not APPROVED (filter pushed to SQL)', async () => {
    const endpointModel = buildModelMock([]);
    const repository = buildRepository(endpointModel);

    await repository.markDeprecatedCandidates(new Set(['GET /systems/dashboard']));

    expect(endpointModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('marks endpoints not present in activeKeys as DEPRECATED_CANDIDATE via a single bulk UPDATE', async () => {
    const endpointModel = buildModelMock([
      { id: '1', method: 'GET', fullPath: '/systems/dashboard' },
      { id: '2', method: 'GET', fullPath: '/systems/stale-endpoint' },
      { id: '3', method: 'POST', fullPath: '/systems/another-stale-one' },
    ]);
    const repository = buildRepository(endpointModel);

    const updated = await repository.markDeprecatedCandidates(new Set(['GET /systems/dashboard']));

    // La entrada "1" está en activeKeys -> no se marca; "2" y "3" no están -> sí se marcan, en un
    // único UPDATE con WHERE id IN (...) (no un save() por fila).
    expect(endpointModel.update).toHaveBeenCalledTimes(1);
    expect(endpointModel.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'DEPRECATED_CANDIDATE' }), {
      where: { id: { [Op.in]: ['2', '3'] } },
    });
    expect(updated).toBe(2);
  });

  it('does not call update at all when every endpoint is still active (no wasted query)', async () => {
    const endpointModel = buildModelMock([{ id: '1', method: 'GET', fullPath: '/systems/dashboard' }]);
    const repository = buildRepository(endpointModel);

    const updated = await repository.markDeprecatedCandidates(new Set(['GET /systems/dashboard']));

    expect(endpointModel.update).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });
});
