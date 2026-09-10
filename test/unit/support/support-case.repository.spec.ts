import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import type { SupportCaseEventModel, SupportCaseModel } from '../../../src/database/models/index.js';

/**
 * El expediente del caso y su historia.
 *
 * Cuatro decisiones y ninguna se ve fallar. `lockById` bloquea la fila ANTES de decidir sobre ella:
 * sin el `FOR UPDATE`, dos agentes que resuelven el mismo caso a la vez leen ambos `IN_PROGRESS`,
 * ambos validan la transición y ambos escriben, dejando dos resoluciones y un solo caso. El
 * `payload_json` del evento se REDACTA al entrar y no al salir, porque es el vector clásico por el
 * que la PII acaba en exportaciones y logs. La secuencia del evento se incrementa en la misma
 * sentencia que la lee, así que el cierre del agente y el aviso de SLA del temporizador reciben
 * números distintos sin esperar a un COUNT. Y el filtro por cómo se resolvió mira sólo la
 * resolución VIGENTE: contar también las reemplazadas daría a «cuántos cerramos por causa
 * desconocida» un número más alto que la realidad.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock; update: jest.Mock };

function doble(): Doble {
  return {
    create: jest.fn(async (values: unknown) => values),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    update: jest.fn(async () => [0]),
  };
}

function ultima(mock: jest.Mock): {
  where: Record<string | symbol, unknown>;
  order?: unknown[];
  limit?: number;
  lock?: unknown;
  transaction?: unknown;
} {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('SupportCaseRepository', () => {
  let query: jest.Mock;
  let escape: jest.Mock;
  let literal: jest.Mock;
  let cases: Doble;
  let events: Doble;
  let repo: SupportCaseRepository;
  const tx = { LOCK: { UPDATE: 'UPDATE' } } as never;

  beforeEach(() => {
    query = jest.fn(async () => [{ last_event_sequence: '4' }]);
    escape = jest.fn((valor: unknown) => `'${String(valor)}'`) as unknown as jest.Mock;
    literal = jest.fn((sql: unknown) => ({ val: String(sql) })) as unknown as jest.Mock;
    cases = doble();
    events = doble();
    repo = new SupportCaseRepository(
      { query, escape, literal } as unknown as Sequelize,
      cases as unknown as typeof SupportCaseModel,
      events as unknown as typeof SupportCaseEventModel,
    );
  });

  describe('leer y bloquear', () => {
    it('por id y por número, siempre con tenant y sin los borrados', async () => {
      await repo.findById('t1', 'caso-1');
      expect(ultima(cases.findOne).where).toEqual({ tenantId: 't1', id: 'caso-1', deleted: false });

      await repo.findByNumber('t1', 'SC-0007');
      expect(ultima(cases.findOne).where).toEqual({ tenantId: 't1', caseNumber: 'SC-0007', deleted: false });
    });

    it('exigirlo cuando no existe es 404 con el código del dominio', async () => {
      await expect(repo.requireById('t1', 'caso-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('bloquear toma el candado de escritura: sin él, dos agentes resolverían el mismo caso a la vez', async () => {
      cases.findOne.mockResolvedValueOnce({ id: 'caso-1' } as never);

      await repo.lockById('t1', 'caso-1', tx);

      expect(ultima(cases.findOne).lock).toBe('UPDATE');
      expect(ultima(cases.findOne).transaction).toBe(tx);
    });

    it('bloquear un caso que no existe es 404 y no un null que el llamador desreferencia', async () => {
      await expect(repo.lockById('t1', 'caso-1', tx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crear y actualizar propagan la transacción, y actualizar sella `updated_at`', async () => {
      await repo.create({ tenantId: 't1' } as never, { transaction: tx });
      expect(cases.create).toHaveBeenCalledWith({ tenantId: 't1' }, { transaction: tx });

      await repo.update('t1', 'caso-1', { status: 'RESOLVED' } as never, { transaction: tx });
      const [values, opciones] = cases.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'caso-1' });
    });
  });

  describe('historia del caso', () => {
    const evento = {
      tenantId: 't1',
      caseId: 'caso-1',
      eventType: 'STATUS_CHANGED' as never,
      actorType: 'internal_user',
      actorId: '7',
      payload: { de: 'NEW', a: 'TRIAGED' },
    };

    it('la secuencia se incrementa en la misma sentencia que la lee', async () => {
      await repo.appendEvent(evento, tx);

      const [sql, opciones] = query.mock.calls[0] as [string, { replacements: Record<string, unknown>; transaction: unknown }];
      expect(sql).toContain('SET last_event_sequence = last_event_sequence + 1');
      expect(sql).toContain('RETURNING last_event_sequence');
      expect(opciones.replacements).toEqual({ tenantId: 't1', caseId: 'caso-1' });
      expect(opciones.transaction).toBe(tx);
    });

    it('el evento nace encadenado al anterior y con la secuencia reservada', async () => {
      events.findOne.mockResolvedValueOnce({ eventHash: 'h-3' } as never);

      const escrito = (await repo.appendEvent(evento, tx)) as unknown as Record<string, unknown>;

      expect(escrito.sequenceNumber).toBe('4');
      expect(escrito.previousHash).toBe('h-3');
      expect(escrito.eventHash).toEqual(expect.any(String));
      expect(escrito.eventHash).not.toBe('h-3');
    });

    it('el primer evento del caso encadena a nulo', async () => {
      const escrito = (await repo.appendEvent(evento, tx)) as unknown as Record<string, unknown>;

      expect(escrito.previousHash).toBeNull();
    });

    it('el payload entra REDACTADO: es el vector por el que la PII acaba en exportaciones', async () => {
      const escrito = (await repo.appendEvent(
        { ...evento, payload: { email: 'ana@atlas.bo', motivo: 'no llega el código' } },
        tx,
      )) as unknown as Record<string, Record<string, unknown>>;

      expect(escrito.payloadJson.email).not.toBe('ana@atlas.bo');
      expect(escrito.payloadJson.motivo).toBe('no llega el código');
    });

    it('el hash se calcula sobre el payload ya redactado: si no, verificar exigiría la PII original', async () => {
      /*
       * El reloj se congela porque `caseEventHash` incluye `occurredAt`.
       *
       * Sin congelarlo, los dos eventos se escriben en milisegundos distintos en cuanto la máquina
       * va cargada y los hashes difieren por la FECHA, no por el payload: la prueba pasaba sola y
       * fallaba una vez de cada tantas en la suite completa. Lo que se compara aquí es el efecto de
       * la redacción, así que todo lo demás tiene que ser idéntico a propósito.
       */
      jest.useFakeTimers().setSystemTime(new Date('2026-09-10T10:00:00.000Z'));
      try {
        const conPii = (await repo.appendEvent({ ...evento, payload: { email: 'ana@atlas.bo' } }, tx)) as unknown as Record<
          string,
          unknown
        >;
        events.findOne.mockResolvedValueOnce(null as never);
        const conOtroPii = (await repo.appendEvent({ ...evento, payload: { email: 'otro@atlas.bo' } }, tx)) as unknown as Record<
          string,
          unknown
        >;

        expect(conPii.eventHash).toBe(conOtroPii.eventHash);
      } finally {
        jest.useRealTimers();
      }
    });

    it('un caso que no existe es 404 y no deja un evento huérfano', async () => {
      query.mockResolvedValueOnce([] as never);

      await expect(repo.appendEvent(evento, tx)).rejects.toBeInstanceOf(NotFoundException);
      expect(events.create).not.toHaveBeenCalled();
    });

    it('la correlación es opcional y viaja como nula cuando no llega', async () => {
      const escrito = (await repo.appendEvent(evento, tx)) as unknown as Record<string, unknown>;
      expect(escrito.correlationId).toBeNull();
      expect(escrito.causationId).toBeNull();
    });

    it('la historia se lee de la primera a la última: es una narración, con tope', async () => {
      await repo.listEvents('caso-1');

      expect(ultima(events.findAll).where).toEqual({ caseId: 'caso-1' });
      expect(ultima(events.findAll).order).toEqual([['sequence_number', 'ASC']]);
      expect(ultima(events.findAll).limit).toBe(200);
    });
  });

  describe('listado del backlog', () => {
    it('sin filtros sólo acota tenant y borrados, y ordena por cursor estable', async () => {
      await repo.listCases({ tenantId: 't1', limit: 20 });

      expect(ultima(cases.findAll).where).toEqual({ tenantId: 't1', deleted: false });
      expect(ultima(cases.findAll).order).toEqual([
        ['opened_at', 'DESC'],
        ['_id', 'DESC'],
      ]);
      expect(ultima(cases.findAll).limit).toBe(20);
    });

    it('cada filtro se aplica sólo cuando llega', async () => {
      await repo.listCases({
        tenantId: 't1',
        customerId: 'c1',
        queueId: 'q1',
        caseType: 'INCIDENT',
        assigneeAgentId: 'ag-1',
        statuses: ['NEW', 'TRIAGED'],
        priorities: ['HIGH'],
        limit: 20,
      });

      const condicion = ultima(cases.findAll).where;
      expect(condicion).toMatchObject({ subjectCustomerId: 'c1', queueId: 'q1', caseType: 'INCIDENT', currentAssigneeAgentId: 'ag-1' });
      expect((condicion.status as Record<symbol, string[]>)[Op.in]).toEqual(['NEW', 'TRIAGED']);
      expect((condicion.priority as Record<symbol, string[]>)[Op.in]).toEqual(['HIGH']);
    });

    it('una lista de estados vacía no filtra: filtrar por nada devolvería cero casos', async () => {
      await repo.listCases({ tenantId: 't1', statuses: [], priorities: [], limit: 20 });

      expect(ultima(cases.findAll).where).not.toHaveProperty('status');
      expect(ultima(cases.findAll).where).not.toHaveProperty('priority');
    });

    it('el cursor desempata por id cuando dos casos se abrieron en el mismo instante', async () => {
      const corte = new Date('2026-09-01T10:00:00Z');
      await repo.listCases({ tenantId: 't1', cursorOpenedAt: corte, cursorId: 'caso-9', limit: 20 });

      const [porFecha, porEmpate] = ultima(cases.findAll).where[Op.or] as [
        { openedAt: Record<symbol, Date> },
        { openedAt: Date; id: Record<symbol, string> },
      ];
      expect(porFecha.openedAt[Op.lt]).toBe(corte);
      expect(porEmpate.openedAt).toBe(corte);
      expect(porEmpate.id[Op.lt]).toBe('caso-9');
    });

    it('un cursor a medias no se aplica: paginaría desde un punto arbitrario', async () => {
      await repo.listCases({ tenantId: 't1', cursorOpenedAt: new Date(), cursorId: null, limit: 20 });

      expect(Object.getOwnPropertySymbols(ultima(cases.findAll).where)).not.toContain(Op.or);
    });

    it('filtrar por cómo se resolvió mira SÓLO la resolución vigente y escapa los códigos', async () => {
      await repo.listCases({ tenantId: 't1', resolutionCode: 'FIXED', rootCauseCode: 'PROVIDER', limit: 20 });

      const subconsulta = String((ultima(cases.findAll).where.id as Record<symbol, { val: string }>)[Op.in].val);
      expect(subconsulta).toContain('superseded_at IS NULL');
      expect(subconsulta).toContain("resolution_code = 'FIXED'");
      expect(subconsulta).toContain("root_cause_code = 'PROVIDER'");
      expect(subconsulta).toContain("_tenant_id = 't1'");
      expect(escape).toHaveBeenCalledWith('FIXED');
    });

    it('sin filtro de resolución no se añade la subconsulta', async () => {
      await repo.listCases({ tenantId: 't1', limit: 20 });

      expect(ultima(cases.findAll).where).not.toHaveProperty('id');
      expect(literal).not.toHaveBeenCalled();
    });
  });

  describe('aviso de duplicado', () => {
    it('busca los casos vivos del mismo sujeto sobre la misma entidad, con tope corto', async () => {
      await repo.findOpenCasesForCustomer('t1', 'c1', 'INCIDENT');

      const condicion = ultima(cases.findAll).where;
      expect(condicion).toMatchObject({ tenantId: 't1', subjectCustomerId: 'c1', caseType: 'INCIDENT', deleted: false });
      expect((condicion.status as Record<symbol, string[]>)[Op.notIn]).toEqual(['CLOSED', 'CANCELLED']);
      expect(ultima(cases.findAll).limit).toBe(5);
    });
  });
});
