import { describe, expect, it, jest } from '@jest/globals';
import { Op, fn, where, col } from 'sequelize';
import { AuthRepository } from '../../../src/modules/auth/auth.repository.js';

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
  return new AuthRepository(
    {} as never, // credentialModel — no usado en estos tests
    {} as never, // refreshTokenModel — no usado en estos tests
    modelMock as never, // internalUserModel
    modelMock as never, // platformUserModel
  );
}

describe('AuthRepository — búsqueda de email case-insensitive', () => {
  it('findInternalUserByEmail normaliza mayúsculas/minúsculas y espacios antes de comparar', async () => {
    const findOne = jest.fn(async () => ({ id: 'internal-1', email: 'pablo.admin@atlas.test' }));
    const repository = buildRepository(findOne as never);

    await repository.findInternalUserByEmail('  Pablo.Admin@ATLAS.test ');

    expect(findOne).toHaveBeenCalledWith({ where: expectedWhere('pablo.admin@atlas.test') });
  });

  it('findPlatformUserByEmail normaliza mayúsculas/minúsculas antes de comparar', async () => {
    const findOne = jest.fn(async () => ({ id: 'platform-1', email: 'pablo.platform@atlas.test' }));
    const repository = buildRepository(findOne as never);

    await repository.findPlatformUserByEmail('PABLO.PLATFORM@atlas.test');

    expect(findOne).toHaveBeenCalledWith({ where: expectedWhere('pablo.platform@atlas.test') });
  });

  it('devuelve null si no hay coincidencia, sin lanzar error', async () => {
    const findOne = jest.fn(async () => null);
    const repository = buildRepository(findOne as never);

    const result = await repository.findInternalUserByEmail('nadie@atlas.test');

    expect(result).toBeNull();
  });
});
