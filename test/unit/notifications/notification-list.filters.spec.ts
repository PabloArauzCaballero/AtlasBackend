import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import { withCreatedBetween, withTextSearch } from '../../../src/modules/notifications/notification-list.filters.js';

describe('Filtros de los listados de notificaciones', () => {
  it('la búsqueda se AÑADE al Op.and existente (p. ej. la vigencia) en vez de pisarlo', () => {
    const vigencia = { [Op.or]: [{ expiresAt: null }] };
    const where: Record<string | symbol, unknown> = { tenantId: 't1', [Op.and]: [vigencia] };
    withTextSearch(where, ' 50% ', ['title', 'body']);
    expect(where[Op.and]).toEqual([vigencia, { [Op.or]: [{ title: { [Op.iLike]: '%50\\%%' } }, { body: { [Op.iLike]: '%50\\%%' } }] }]);
  });

  it('sin texto no toca el WHERE', () => {
    const where: Record<string | symbol, unknown> = { tenantId: 't1' };
    withTextSearch(where, '  ', ['title']);
    withCreatedBetween(where, {});
    expect(where).toEqual({ tenantId: 't1' });
  });

  it('la ventana de fechas admite un extremo abierto', () => {
    const where: Record<string | symbol, unknown> = {};
    const desde = new Date('2026-09-01T00:00:00Z');
    withCreatedBetween(where, { from: desde });
    expect(where.createdAtValue).toEqual({ [Op.gte]: desde });
  });
});
