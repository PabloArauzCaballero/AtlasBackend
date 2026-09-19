import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { SupportCaseTimelineRepository } from '../../../src/modules/support/support-case-timeline.repository.js';
import type {
  SupportAssignmentModel,
  SupportCaseFeedbackModel,
  SupportCaseLinkModel,
  SupportCaseReferenceModel,
  SupportResolutionModel,
  SupportSlaClockModel,
} from '../../../src/database/models/index.js';

/**
 * La línea de tiempo de un caso de soporte.
 *
 * Lo que se fija son las cuatro condiciones que deciden qué es «lo vigente» y que, mal escritas, no
 * rompen nada: la asignación viva es la que no está liberada, la resolución vigente es la que no
 * está superada, y los dos barridos de SLA parten el tiempo en `now` sin dejar hueco ni solaparse
 * —un reloj que cae en los dos sale marcado y avisado a la vez; uno que no cae en ninguno se
 * incumple en silencio—. Y que los enlaces entre casos se lean en los dos sentidos: guardados en
 * una sola fila, leerlos por un solo extremo esconde la mitad.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock; update: jest.Mock };

function doble(): Doble {
  return {
    create: jest.fn(async () => ({ id: 'x' })),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    update: jest.fn(async () => [0]),
  };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; order?: unknown[]; limit?: number; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('SupportCaseTimelineRepository', () => {
  let assignments: Doble;
  let clocks: Doble;
  let resolutions: Doble;
  let links: Doble;
  let references: Doble;
  let feedback: Doble;
  let repo: SupportCaseTimelineRepository;
  const tx = {} as never;

  beforeEach(() => {
    assignments = doble();
    clocks = doble();
    resolutions = doble();
    links = doble();
    references = doble();
    feedback = doble();
    repo = new SupportCaseTimelineRepository(
      assignments as unknown as typeof SupportAssignmentModel,
      clocks as unknown as typeof SupportSlaClockModel,
      resolutions as unknown as typeof SupportResolutionModel,
      links as unknown as typeof SupportCaseLinkModel,
      references as unknown as typeof SupportCaseReferenceModel,
      feedback as unknown as typeof SupportCaseFeedbackModel,
    );
  });

  describe('asignaciones', () => {
    it('la asignación viva es la no liberada, y la más reciente si hubo varias', async () => {
      await repo.findLiveAssignment('caso-1');

      expect(ultima(assignments.findOne).where).toEqual({ caseId: 'caso-1', releasedAt: null });
      expect(ultima(assignments.findOne).order).toEqual([['assigned_at', 'DESC']]);
    });

    it('liberar escribe el motivo: sin él, el historial no dice por qué terminó la responsabilidad', async () => {
      await repo.releaseLiveAssignment('caso-1', 'REASSIGNED', { transaction: tx });

      const [values, opciones] = assignments.update.mock.calls.at(-1) as [
        Record<string, unknown>,
        { where: unknown; transaction: unknown },
      ];
      expect(values.releaseReason).toBe('REASSIGNED');
      expect(values.releasedAt).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ caseId: 'caso-1', releasedAt: null });
      expect(opciones.transaction).toBe(tx);
    });

    it('crear una asignación propaga la transacción de quien reasigna', async () => {
      await repo.createAssignment({ caseId: 'caso-1' } as never, { transaction: tx });
      expect(assignments.create).toHaveBeenCalledWith({ caseId: 'caso-1' }, { transaction: tx });
    });

    it('el historial de asignaciones va de la primera a la última: es una narración, no una bandeja', async () => {
      await repo.listAssignments('caso-1');
      expect(ultima(assignments.findAll).order).toEqual([['assigned_at', 'ASC']]);
    });
  });

  describe('relojes de SLA', () => {
    it('un reloj se localiza por caso y métrica: hay más de uno por caso', async () => {
      await repo.findClock('caso-1', 'FIRST_RESPONSE');
      expect(ultima(clocks.findOne).where).toEqual({ caseId: 'caso-1', metricType: 'FIRST_RESPONSE' });
    });

    it('listar y crear relojes van dentro de la transacción del caso', async () => {
      await repo.listClocks('caso-1', { transaction: tx });
      expect(ultima(clocks.findAll).transaction).toBe(tx);

      await repo.createClock({ caseId: 'caso-1' } as never, { transaction: tx });
      expect(clocks.create).toHaveBeenCalledWith({ caseId: 'caso-1' }, { transaction: tx });
    });

    it('actualizar un reloj sella `updated_at` y apunta a ese reloj', async () => {
      await repo.updateClock('reloj-1', { state: 'BREACHED' } as never);

      const [values, opciones] = clocks.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.state).toBe('BREACHED');
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ id: 'reloj-1' });
    });

    it('vencidos y por vencer parten el tiempo en `now` sin hueco ni solape', async () => {
      const now = new Date('2026-09-10T12:00:00Z');
      await repo.findBreachedClocks('t1', now);
      const vencidos = ultima(clocks.findAll).where;
      await repo.findRunningClocks('t1', now);
      const corriendo = ultima(clocks.findAll).where;

      expect((vencidos.targetAt as Record<symbol, Date>)[Op.lte]).toBe(now);
      expect((corriendo.targetAt as Record<symbol, Date>)[Op.gt]).toBe(now);
      expect(vencidos.state).toBe('RUNNING');
      expect(corriendo.state).toBe('RUNNING');
      expect(vencidos.tenantId).toBe('t1');
      expect(corriendo.tenantId).toBe('t1');
    });

    it('los dos barridos atienden primero lo más urgente y llevan tope', async () => {
      await repo.findBreachedClocks('t1', new Date());
      expect(ultima(clocks.findAll).order).toEqual([['target_at', 'ASC']]);
      expect(ultima(clocks.findAll).limit).toBe(200);

      await repo.findRunningClocks('t1', new Date());
      expect(ultima(clocks.findAll).limit).toBe(500);
    });
  });

  describe('resoluciones', () => {
    it('la primera resolución de un caso es la número 1, no la 0', async () => {
      resolutions.findOne.mockResolvedValueOnce(null as never);
      await expect(repo.nextResolutionSequence('caso-1')).resolves.toBe(1);
    });

    it('la siguiente parte de la mayor existente: una reapertura no reescribe la anterior', async () => {
      resolutions.findOne.mockResolvedValueOnce({ resolutionSequence: 3 } as never);

      await expect(repo.nextResolutionSequence('caso-1')).resolves.toBe(4);
      expect(ultima(resolutions.findOne).order).toEqual([['resolution_sequence', 'DESC']]);
    });

    it('la resolución vigente es la no superada de mayor número', async () => {
      await repo.findCurrentResolution('caso-1');

      expect(ultima(resolutions.findOne).where).toEqual({ caseId: 'caso-1', supersededAt: null });
      expect(ultima(resolutions.findOne).order).toEqual([['resolution_sequence', 'DESC']]);
    });

    it('reabrir marca como superada y conserva el texto: no borra la resolución anterior', async () => {
      await repo.supersedeResolutions('caso-1', { transaction: tx });

      const [values, opciones] = resolutions.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(Object.keys(values)).toEqual(['supersededAt']);
      expect(values.supersededAt).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ caseId: 'caso-1', supersededAt: null });
    });

    it('crear una resolución propaga la transacción', async () => {
      await repo.createResolution({ caseId: 'caso-1' } as never, { transaction: tx });
      expect(resolutions.create).toHaveBeenCalledWith({ caseId: 'caso-1' }, { transaction: tx });
    });
  });

  describe('enlaces y referencias', () => {
    it('los enlaces se leen por los dos extremos: la fila es una y el caso puede ser cualquiera de los dos', async () => {
      await repo.listLinks('caso-1');

      expect(ultima(links.findAll).where[Op.or]).toEqual([{ caseId: 'caso-1' }, { linkedCaseId: 'caso-1' }]);
    });

    it('crear un enlace propaga la transacción', async () => {
      await repo.createLink({ caseId: 'caso-1' } as never, { transaction: tx });
      expect(links.create).toHaveBeenCalledWith({ caseId: 'caso-1' }, { transaction: tx });
    });

    it('las referencias salen en el orden en que se añadieron', async () => {
      await repo.listReferences('caso-1');

      expect(ultima(references.findAll).where).toEqual({ caseId: 'caso-1' });
      expect(ultima(references.findAll).order).toEqual([['_created_at', 'ASC']]);
    });

    it('crear una referencia propaga la transacción', async () => {
      await repo.createReference({ caseId: 'caso-1' } as never, { transaction: tx });
      expect(references.create).toHaveBeenCalledWith({ caseId: 'caso-1' }, { transaction: tx });
    });
  });

  describe('encuesta', () => {
    it('la encuesta es por caso Y respondiente: el cliente y el comercio opinan por separado', async () => {
      await repo.findFeedback('caso-1', 'customer', '42');

      expect(ultima(feedback.findOne).where).toEqual({ caseId: 'caso-1', respondentActorType: 'customer', respondentActorId: '42' });
    });

    it('crear la respuesta propaga la transacción', async () => {
      await repo.createFeedback({ caseId: 'caso-1' } as never, { transaction: tx });
      expect(feedback.create).toHaveBeenCalledWith({ caseId: 'caso-1' }, { transaction: tx });
    });
  });
});
