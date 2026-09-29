import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import { internalUsersListQuery } from '../../../src/modules/internal-users/internal-users-list.filter.js';

/**
 * El listado de usuarios internos buscaba en el navegador sobre la primera página (50): la persona 51
 * no aparecía. Aquí se fija que la búsqueda, el estado y el rol salen en la consulta al servidor.
 */
describe('internalUsersListQuery', () => {
  const and = (where: unknown) => (where as Record<symbol, unknown[]>)[Op.and] as Array<Record<string | symbol, unknown>>;

  it('sin filtros sólo acota tenant y borrados, y pagina por offset', () => {
    const query = internalUsersListQuery('7', {}, { page: 3, limit: 20 });
    expect(and(query.where)).toEqual([{ tenantId: '7' }, { deleted: { [Op.ne]: true } }]);
    expect(query).toMatchObject({ limit: 20, offset: 40, replacements: { listTenantId: '7' } });
  });

  it('q busca por partes en correo, nombre, departamento, cargo y rol asignado, con comodines escapados', () => {
    const query = internalUsersListQuery('7', { q: ' 50%_ana ' }, { page: 1, limit: 50 });
    const busqueda = and(query.where).at(-1)?.[Op.or] as Array<Record<string, unknown>>;
    const pattern = '%50\\%\\_ana%';
    expect(busqueda.slice(0, 4)).toEqual([
      { email: { [Op.iLike]: pattern } },
      { fullName: { [Op.iLike]: pattern } },
      { department: { [Op.iLike]: pattern } },
      { jobTitle: { [Op.iLike]: pattern } },
    ]);
    const porRol = (busqueda[4]?.id as Record<symbol, { val: string }>)[Op.in].val;
    expect(porRol).toMatch(/ur\.revoked_at IS NULL AND r\.role_code ILIKE :listPattern/);
    expect(query.replacements).toEqual({ listTenantId: '7', listPattern: pattern });
  });

  it('status y role filtran; el rol por asignación viva, no por la columna heredada', () => {
    const query = internalUsersListQuery('7', { status: 'suspended', role: 'SUPER_ADMIN' }, { page: 1, limit: 50 });
    const condiciones = and(query.where);
    expect(condiciones).toContainEqual({ status: 'suspended' });
    const porRol = condiciones.find((condicion) => 'id' in condicion)?.id as Record<symbol, { val: string }>;
    expect(porRol[Op.in].val).toMatch(/r\.role_code = :listRole/);
    expect(porRol[Op.in].val).toMatch(/r\.status = 'active' AND r\._deleted = false/);
    expect(query.replacements.listRole).toBe('SUPER_ADMIN');
    expect(condiciones.some((condicion) => 'roleCode' in condicion)).toBe(false);
  });
});
