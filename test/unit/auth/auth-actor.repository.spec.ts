import { describe, expect, it, jest } from '@jest/globals';
import { Op, fn, where, col } from 'sequelize';
import { AuthActorRepository } from '../../../src/modules/auth/auth-actor.repository.js';

/**
 * ATLAS-P10-045: antes, `findInternalUserByEmail`/`findPlatformUserByEmail` comparaban el email
 * tal como estaba almacenado (case-sensitive), documentado como SUPUESTO_ATLAS en
 * docs/architecture/assumptions.md. Este test fija el contrato correcto: la búsqueda debe
 * normalizar tanto el valor ingresado como la columna a minúsculas antes de comparar.
 */
function expectedWhere(emailLowercased: string) {
  return {
    [Op.and]: [where(fn('lower', col('email')), emailLowercased), { deleted: { [Op.ne]: true } }],
  };
}

function buildRepository(findOneMock: jest.Mock) {
  const modelMock = { findOne: findOneMock };
  return new AuthActorRepository(modelMock as never, modelMock as never);
}

describe('AuthActorRepository — búsqueda de email case-insensitive', () => {
  it('findInternalUserByEmail normaliza mayúsculas/minúsculas y espacios antes de comparar', async () => {
    const findOne = jest.fn(async (..._args: unknown[]) => ({ id: 'internal-1', email: 'pablo.admin@atlas.test' }));
    const repository = buildRepository(findOne as never);

    await repository.findInternalUserByEmail('  Pablo.Admin@ATLAS.test ');

    expect(findOne).toHaveBeenCalledWith({ where: expectedWhere('pablo.admin@atlas.test') });
  });

  it('findPlatformUserByEmail normaliza mayúsculas/minúsculas antes de comparar', async () => {
    const findOne = jest.fn(async (..._args: unknown[]) => ({ id: 'platform-1', email: 'pablo.platform@atlas.test' }));
    const repository = buildRepository(findOne as never);

    await repository.findPlatformUserByEmail('PABLO.PLATFORM@atlas.test');

    expect(findOne).toHaveBeenCalledWith({ where: expectedWhere('pablo.platform@atlas.test') });
  });

  it('devuelve null si no hay coincidencia, sin lanzar error', async () => {
    const findOne = jest.fn(async (..._args: unknown[]) => null);
    const repository = buildRepository(findOne as never);

    const result = await repository.findInternalUserByEmail('nadie@atlas.test');

    expect(result).toBeNull();
  });

  it('findInternalUserById / findPlatformUserById filtran por id', async () => {
    const internal = jest.fn(async (..._args: unknown[]) => ({ id: '5' }));
    const platform = jest.fn(async (..._args: unknown[]) => null);
    const repository = new AuthActorRepository({ findOne: internal } as never, { findOne: platform } as never);
    await repository.findInternalUserById('5');
    expect(internal.mock.calls[0][0]).toMatchObject({ where: { id: '5' } });
    await repository.findPlatformUserById('9');
    expect(platform.mock.calls[0][0]).toMatchObject({ where: { id: '9' } });
  });
});
