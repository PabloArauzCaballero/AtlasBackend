import { describe, expect, it } from '@jest/globals';
import { Op } from 'sequelize';
import { eventListWhere } from '../../../src/modules/events/events-list.where.js';

/**
 * El buscador del outbox: antes el portal escribía el MISMO `eventCode` exacto desde el buscador y
 * desde el desplegable. `q` busca por parte en tres columnas y escapa los comodines de LIKE.
 */
describe('eventListWhere', () => {
  it('q busca por parte en código, agregado y correlación, con % y _ escapados', () => {
    const where = eventListWhere('1', { q: 'loan_50%' });
    const pattern = '%loan\\_50\\%%';
    expect(where[Op.or]).toEqual([
      { eventCode: { [Op.iLike]: pattern } },
      { aggregateType: { [Op.iLike]: pattern } },
      { correlationId: { [Op.iLike]: pattern } },
    ]);
  });

  it('sin q no añade OR; los filtros exactos se mantienen', () => {
    const where = eventListWhere('1', { status: 'failed', eventCode: 'loan.disbursed' });
    expect(where).toEqual({ tenantId: '1', status: 'failed', eventCode: 'loan.disbursed' });
    expect(where[Op.or]).toBeUndefined();
  });

  it('para el resumen por estado se omite el filtro de estado y se conserva el resto', () => {
    expect(eventListWhere('1', { status: 'failed', aggregateType: 'loan' }, false)).toEqual({ tenantId: '1', aggregateType: 'loan' });
  });
});
