import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { supportCaseSearchConditions } from '../../../src/modules/support/support-case-list.where.js';
import { listInternalCasesQuerySchema } from '../../../src/modules/support/support-case-list.schemas.js';
import { listCasesQuerySchema } from '../../../src/modules/support/support-case.schemas.js';
import { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import type { SupportCaseEventModel, SupportCaseModel } from '../../../src/database/models/index.js';

const escape = (value: string) => `'${value.replace(/'/g, "''")}'`;

describe('Bandeja de soporte: búsqueda, visibilidad y resumen', () => {
  it('q busca por número de caso, asunto y código de cliente, escapando comodines y comillas', () => {
    const [busqueda] = supportCaseSearchConditions('t1', { q: "o'brien_5%" }, escape) as Array<Record<symbol, unknown[]>>;
    const [numero, asunto, cliente] = busqueda![Op.or] as Array<Record<string, Record<symbol, unknown>>>;
    expect(numero!.caseNumber![Op.iLike]).toBe("%o'brien\\_5\\%%");
    expect(asunto!.title![Op.iLike]).toBe("%o'brien\\_5\\%%");
    const sub = (cliente!.subjectCustomerId![Op.in] as { val: string }).val;
    expect(sub).toContain("c._tenant_id = 't1' AND c.customer_code ILIKE '%o''brien\\_5\\%%'");
  });

  it('sin q ni visibilidad no añade condiciones; un supervisor ve los restringidos', () => {
    expect(supportCaseSearchConditions('t1', {}, escape)).toEqual([]);
    expect(supportCaseSearchConditions('t1', { restrictedVisibleTo: { agentProfileId: 'a1', isSupervisor: true } }, escape)).toEqual([]);
  });

  it('un agente sólo ve restringidos si los tiene asignados, en la propia consulta', () => {
    expect(supportCaseSearchConditions('t1', { restrictedVisibleTo: { agentProfileId: 'a1', isSupervisor: false } }, escape)).toEqual([
      { [Op.or]: [{ sensitivity: { [Op.ne]: 'RESTRICTED' } }, { currentAssigneeAgentId: 'a1' }] },
    ]);
  });

  it('sin perfil de agente no hay «asignado a mí»: no se cuelan los restringidos sin responsable', () => {
    expect(supportCaseSearchConditions('t1', { restrictedVisibleTo: { agentProfileId: null, isSupervisor: false } }, escape)).toEqual([
      { [Op.or]: [{ sensitivity: { [Op.ne]: 'RESTRICTED' } }] },
    ]);
  });

  it('q sólo existe en el listado del equipo, no en el de los casos propios', () => {
    expect(listInternalCasesQuerySchema.parse({ q: 'SUP-1' }).q).toBe('SUP-1');
    expect('q' in listCasesQuerySchema.parse({ q: 'SUP-1' })).toBe(false);
  });

  it('el resumen cuenta el filtro ENTERO: total, P1/P2 y sin agente, con la misma visibilidad', async () => {
    const count = jest.fn(async (_options: unknown) => 5);
    const repo = new SupportCaseRepository(
      { escape } as unknown as Sequelize,
      { count } as unknown as typeof SupportCaseModel,
      {} as unknown as typeof SupportCaseEventModel,
    );
    const resumen = await repo.summarizeCases({
      tenantId: 't1',
      priorities: ['P3'],
      restrictedVisibleTo: { agentProfileId: 'a1', isSupervisor: false },
    });
    expect(resumen).toEqual({ total: 5, highPriority: 5, unassigned: 5 });
    const wheres = count.mock.calls.map((call) => (call[0] as { where: Record<string | symbol, unknown> }).where);
    for (const where of wheres) {
      expect(where).toMatchObject({ tenantId: 't1', deleted: false, priority: { [Op.in]: ['P3'] } });
      expect(where[Op.and]).toContainEqual({ [Op.or]: [{ sensitivity: { [Op.ne]: 'RESTRICTED' } }, { currentAssigneeAgentId: 'a1' }] });
    }
    // El contador de P1/P2 se cruza con el filtro de prioridad en vez de pisarlo.
    expect(wheres[1]![Op.and]).toContainEqual({ priority: { [Op.in]: ['P1', 'P2'] } });
    expect(wheres[2]![Op.and]).toContainEqual({ currentAssigneeAgentId: null });
  });
});
