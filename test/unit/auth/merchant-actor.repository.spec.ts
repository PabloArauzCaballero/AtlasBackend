import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { MerchantActorRepository } from '../../../src/modules/auth/merchant-actor.repository.js';

/**
 * Lectura de la cuarta población autenticable: el usuario del comercio afiliado.
 *
 * Lo que estas pruebas fijan es la forma de la consulta, porque es donde aparecen los "existe pero
 * no puede entrar": el índice único de la migración indexa `lower(btrim(email))`, así que buscar de
 * otra manera devuelve `null` sobre una fila que sí está.
 */
describe('MerchantActorRepository', () => {
  function build() {
    const merchantUserModel = {
      findOne: jest.fn(async (..._args: unknown[]) => null),
      update: jest.fn(async (..._args: unknown[]) => [1]),
    };
    return { repository: new MerchantActorRepository(merchantUserModel as never), merchantUserModel };
  }

  it('normaliza el correo igual que el índice: minúsculas y sin espacios alrededor', async () => {
    const { repository, merchantUserModel } = build();

    await repository.findMerchantUserByEmail('  Tienda@Ejemplo.COM ');

    const filters = (merchantUserModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<symbol, unknown[]> };
    expect(JSON.stringify(filters.where[Op.and])).toContain('tienda@ejemplo.com');
  });

  it('acota por tenant sólo cuando se lo piden', async () => {
    const { repository, merchantUserModel } = build();

    await repository.findMerchantUserByEmail('tienda@ejemplo.com');
    const sinTenant = (merchantUserModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<symbol, unknown[]> };
    expect(sinTenant.where[Op.and]).toHaveLength(2);

    await repository.findMerchantUserByEmail('tienda@ejemplo.com', '7');
    const conTenant = (merchantUserModel.findOne as jest.Mock).mock.calls[1][0] as { where: Record<symbol, unknown[]> };
    expect(conTenant.where[Op.and]).toContainEqual({ tenantId: '7' });
  });

  it('excluye borrados al resolver por id', async () => {
    const { repository, merchantUserModel } = build();

    await repository.findMerchantUserById('42');

    const args = (merchantUserModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ id: '42' });
    expect(args.where.deleted).toBeDefined();
  });

  it('sella el último acceso sin tocar ningún otro campo de la identidad', async () => {
    const { repository, merchantUserModel } = build();

    await repository.touchMerchantUserLogin('42');

    const [values, options] = (merchantUserModel.update as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
      { where: Record<string, unknown> },
    ];
    expect(Object.keys(values).sort()).toEqual(['lastLoginAt', 'updatedAtValue']);
    expect(options.where).toMatchObject({ id: '42' });
  });
});
