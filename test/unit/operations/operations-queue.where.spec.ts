import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import { fraudQueueWhere, manualReviewQueueWhere } from '../../../src/modules/operations/operations-queue.where.js';

const escape = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** El buscador de la cola (2026-09-29): antes sólo aceptaba el número interno del cliente, exacto. */
describe('filtros de la cola de trabajo', () => {
  it('q busca el código del caso y el del cliente (subconsulta con el patrón escapado)', () => {
    const where = manualReviewQueueWhere('1', { q: "CUS_1'" }, escape);
    const or = where[Op.or] as Record<string, unknown>[];
    expect(or[0]).toEqual({ caseCode: { [Op.iLike]: "%CUS\\_1'%" } });
    const sub = ((or[1] as { customerId: Record<symbol, { val: string }> }).customerId[Op.in] as { val: string }).val;
    expect(sub).toContain("customer_code ILIKE '%CUS\\_1''%'");
    expect(sub).toContain("c._tenant_id = '1'");
    // Sin dígitos puros no se compara con ids.
    expect(or).toHaveLength(2);
  });

  it('sólo dígitos: además el número del caso y el del cliente, exactos', () => {
    const or = fraudQueueWhere('1', { q: '42' }, escape)[Op.or] as Record<string, unknown>[];
    expect(or).toEqual(expect.arrayContaining([{ id: '42' }, { customerId: '42' }]));
  });

  it('un número que no cabe en bigint no se compara con ids (Postgres daría 22003)', () => {
    const or = fraudQueueWhere('1', { q: '9999999999999999999' }, escape)[Op.or] as Record<string, unknown>[];
    expect(or).toHaveLength(2);
    const max = fraudQueueWhere('1', { q: '9223372036854775807' }, escape)[Op.or] as Record<string, unknown>[];
    expect(max).toHaveLength(4);
  });

  it('estado y prioridad: status/priority en revisión manual, caseStatus/severity en fraude', () => {
    expect(manualReviewQueueWhere('1', { status: 'open', priority: 'high' }, escape)).toMatchObject({ status: 'open', priority: 'high' });
    expect(fraudQueueWhere('1', { status: 'open', priority: 'high' }, escape)).toMatchObject({ caseStatus: 'open', severity: 'high' });
  });

  it('sin q no se pide escape ni se añade OR', () => {
    const where = manualReviewQueueWhere('1', {}, () => {
      throw new Error('no debería escapar');
    });
    expect(where[Op.or]).toBeUndefined();
  });
});
