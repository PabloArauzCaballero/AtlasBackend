import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { SupportCaseWorkflowService } from '../../../src/modules/support/application/support-case-workflow.service.js';
import type { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import type { SupportCaseTimelineRepository } from '../../../src/modules/support/support-case-timeline.repository.js';
import type { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';
import type { SupportAgentRepository } from '../../../src/modules/support/support-agent.repository.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportMessageService } from '../../../src/modules/support/application/support-message.service.js';
import type { SupportCaseMembershipService } from '../../../src/modules/support/application/support-case-membership.service.js';
import type { SupportCaseTransitionService } from '../../../src/modules/support/application/support-case-transition.service.js';
import type { SupportActorService, SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportAuditService } from '../../../src/modules/support/application/support-audit.service.js';
import type { SupportCaseRoutingService } from '../../../src/modules/support/application/support-case-routing.service.js';
import type { SupportCaseModel } from '../../../src/database/models/index.js';

/**
 * Clasificar, asignar y transferir.
 *
 * Tres reglas, y las tres protegen algo que no es técnico.
 *
 * Un agente sólo puede tomarse a SÍ MISMO; asignar a otro es de supervisores. Sin esa distinción
 * aparece el patrón clásico de repartirse el trabajo entre pares, y la cola deja de reflejar quién
 * está realmente trabajando en qué.
 *
 * La transferencia es CÁLIDA: el agente que se va deja un resumen dentro de la conversación, y
 * entra como nota INTERNA porque es contexto para el equipo, no un mensaje para el cliente. Sin ese
 * resumen, el cliente cuenta otra vez toda su historia al siguiente agente, que es la experiencia
 * que la gente recuerda como «me pasaron de un lado a otro».
 *
 * Y el triaje NO retrocede el estado: un caso ya en curso se reclasifica sin volver a `TRIAGED`, y
 * `triagedAt` conserva la PRIMERA vez. Si no, cada reclasificación reiniciaría el reloj y un caso
 * lento parecería recién llegado.
 */
const AGENTE = { actorType: 'AGENT', actorId: '7', agentProfileId: 'ag-1', isSupervisor: false } as SupportActor;
const SUPERVISOR = { ...AGENTE, isSupervisor: true } as SupportActor;

function caso(overrides: Record<string, unknown> = {}): SupportCaseModel {
  return {
    id: 7,
    caseNumber: 'SC-0007',
    status: 'NEW',
    caseType: 'INCIDENT',
    domain: 'AUTH',
    categoryId: 22,
    queueId: 11,
    sensitivity: 'NORMAL',
    internalSummary: 'lo de siempre',
    currentAssigneeAgentId: null,
    triagedAt: null,
    transferCount: 0,
    lastEventSequence: 12,
    reopenedCount: 0,
    originContextJson: {},
    ...overrides,
  } as unknown as SupportCaseModel;
}

describe('SupportCaseWorkflowService', () => {
  let cases: { requireById: jest.Mock };
  let timeline: { releaseLiveAssignment: jest.Mock; createAssignment: jest.Mock };
  let catalog: { requireQueueByCode: jest.Mock };
  let agents: { findById: jest.Mock };
  let membership: { joinCaseChannels: jest.Mock; leaveCaseChannels: jest.Mock };
  let transitions: { apply: jest.Mock };
  let actors: { assertIsAgent: jest.Mock };
  let audit: { record: jest.Mock; publish: jest.Mock };
  let enrutado: { resolveClassification: jest.Mock; leaveHandoverSummary: jest.Mock };
  let service: SupportCaseWorkflowService;

  beforeEach(() => {
    cases = { requireById: jest.fn(async () => caso()) };
    timeline = { releaseLiveAssignment: jest.fn(async () => undefined), createAssignment: jest.fn(async () => ({ id: 1 })) };
    catalog = { requireQueueByCode: jest.fn(async () => ({ id: 33 })) };
    agents = { findById: jest.fn(async () => ({ id: 'ag-1', isActive: true, internalUserId: 7 })) };
    membership = { joinCaseChannels: jest.fn(async () => undefined), leaveCaseChannels: jest.fn(async () => undefined) };
    transitions = { apply: jest.fn(async () => undefined) };
    actors = { assertIsAgent: jest.fn(() => 'ag-1') };
    audit = { record: jest.fn(async () => undefined), publish: jest.fn(async () => undefined) };
    enrutado = {
      resolveClassification: jest.fn(async () => ({
        category: { id: 99, sensitivity: 'RESTRICTED' },
        queue: { id: 44 },
        impact: 'HIGH',
        urgency: 'HIGH',
        caseType: 'INCIDENT',
        priority: 'P1',
      })),
      leaveHandoverSummary: jest.fn(async () => undefined),
    };

    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    service = new SupportCaseWorkflowService(
      sequelize,
      cases as unknown as SupportCaseRepository,
      timeline as unknown as SupportCaseTimelineRepository,
      catalog as unknown as SupportCatalogRepository,
      agents as unknown as SupportAgentRepository,
      {} as unknown as SupportChannelRepository,
      {} as unknown as SupportMessageService,
      membership as unknown as SupportCaseMembershipService,
      transitions as unknown as SupportCaseTransitionService,
      actors as unknown as SupportActorService,
      audit as unknown as SupportAuditService,
      enrutado as unknown as SupportCaseRoutingService,
    );
  });

  describe('reclasificar', () => {
    it('es cosa del equipo, y la clasificación la resuelve el enrutador', async () => {
      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'mal clasificado' } as never });

      expect(actors.assertIsAgent).toHaveBeenCalledWith(AGENTE);
      expect(enrutado.resolveClassification).toHaveBeenCalledWith(
        't1',
        AGENTE,
        expect.anything(),
        { reason: 'mal clasificado' },
        expect.anything(),
      );
    });

    it('un caso NUEVO pasa a TRIAGED; uno ya en curso conserva su estado', async () => {
      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });
      expect(transitions.apply).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'TRIAGED' }));

      cases.requireById.mockResolvedValue(caso({ status: 'IN_PROGRESS' }) as never);
      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });
      expect(transitions.apply).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'IN_PROGRESS' }));
    });

    it('`triagedAt` conserva la PRIMERA vez: si no, un caso lento parecería recién llegado', async () => {
      const primera = new Date('2026-09-01T10:00:00Z');
      cases.requireById.mockResolvedValue(caso({ triagedAt: primera }) as never);

      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(transitions.apply).toHaveBeenCalledWith(expect.objectContaining({ extra: expect.objectContaining({ triagedAt: primera }) }));
    });

    it('sin triaje previo se sella la fecha ahora', async () => {
      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      const extra = (transitions.apply.mock.calls.at(-1)?.[0] as { extra: Record<string, unknown> }).extra;
      expect(extra.triagedAt).toBeInstanceOf(Date);
    });

    it('la categoría nueva arrastra su sensibilidad, su cola y su prioridad', async () => {
      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(transitions.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ categoryId: '99', sensitivity: 'RESTRICTED', queueId: '44', priority: 'P1', impact: 'HIGH' }),
        }),
      );
    });

    it('sin categoría ni cola nuevas se conservan las del caso, no se ponen a nulo', async () => {
      enrutado.resolveClassification.mockResolvedValueOnce({
        category: null,
        queue: null,
        impact: 'LOW',
        urgency: 'LOW',
        caseType: 'REQUEST',
        priority: 'P4',
      } as never);

      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(transitions.apply).toHaveBeenCalledWith(
        expect.objectContaining({ extra: expect.objectContaining({ categoryId: 22, queueId: 11, sensitivity: 'NORMAL' }) }),
      );
    });

    it('el dominio y el resumen interno sólo se cambian si llegan', async () => {
      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });
      expect(transitions.apply).toHaveBeenLastCalledWith(
        expect.objectContaining({ extra: expect.objectContaining({ domain: 'AUTH', internalSummary: 'lo de siempre' }) }),
      );

      await service.triage({
        tenantId: 't1',
        actor: AGENTE,
        caseId: '7',
        dto: { reason: 'x', domain: 'PAGOS', internalSummary: 'otra cosa' } as never,
      });
      expect(transitions.apply).toHaveBeenLastCalledWith(
        expect.objectContaining({ extra: expect.objectContaining({ domain: 'PAGOS', internalSummary: 'otra cosa' }) }),
      );
    });

    it('el triaje queda auditado con su motivo', async () => {
      await service.triage({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'mal clasificado' } as never });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actionCode: 'support.case.triage', payload: { reason: 'mal clasificado' } }),
      );
    });
  });

  describe('asignar', () => {
    it('sin destinatario, un agente se toma a sí mismo', async () => {
      await service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'lo tomo' } as never });

      expect(agents.findById).toHaveBeenCalledWith('t1', 'ag-1');
      expect(transitions.apply).toHaveBeenCalledWith(expect.objectContaining({ extra: { currentAssigneeAgentId: 'ag-1' } }));
    });

    it('asignar a OTRO exige ser supervisor', async () => {
      const fallo = await service
        .assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x', agentProfileId: 'ag-otro' } as never })
        .catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ForbiddenException);
      expect((fallo as ForbiddenException).getResponse()).toMatchObject({ code: 'SUPPORT_ASSIGN_REQUIRES_SUPERVISOR' });
      expect(agents.findById).not.toHaveBeenCalled();
    });

    it('un supervisor sí puede', async () => {
      agents.findById.mockResolvedValueOnce({ id: 'ag-otro', isActive: true, internalUserId: 9 } as never);

      await expect(
        service.assign({ tenantId: 't1', actor: SUPERVISOR, caseId: '7', dto: { reason: 'x', agentProfileId: 'ag-otro' } as never }),
      ).resolves.toBeDefined();
    });

    it('un agente dado de baja no recibe casos, y se distingue de uno inexistente por el mismo 404', async () => {
      agents.findById.mockResolvedValueOnce({ id: 'ag-1', isActive: false } as never);
      await expect(service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never })).rejects.toBeInstanceOf(
        NotFoundException,
      );

      agents.findById.mockResolvedValueOnce(null as never);
      await expect(service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reasignar al MISMO agente es 409: no se escribe una asignación que no cambia nada', async () => {
      cases.requireById.mockResolvedValue(caso({ currentAssigneeAgentId: 'ag-1' }) as never);

      await expect(service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(timeline.createAssignment).not.toHaveBeenCalled();
    });

    it('se libera la responsabilidad anterior ANTES de abrir la nueva', async () => {
      const orden: string[] = [];
      timeline.releaseLiveAssignment.mockImplementation(async () => {
        orden.push('liberar');
      });
      timeline.createAssignment.mockImplementation(async () => {
        orden.push('crear');
        return { id: 1 };
      });

      await service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(orden).toEqual(['liberar', 'crear']);
    });

    it('el agente entra en los canales del caso: asignarlo sin meterlo dentro lo deja mirando desde fuera', async () => {
      await service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(membership.joinCaseChannels).toHaveBeenCalledWith(
        expect.objectContaining({ agentProfileId: 'ag-1', agentInternalUserId: '7' }),
        expect.anything(),
      );
    });

    it('un caso NUEVO o triado pasa a ASSIGNED; uno en curso conserva su estado', async () => {
      for (const estado of ['NEW', 'TRIAGED']) {
        cases.requireById.mockResolvedValue(caso({ status: estado }) as never);
        await service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });
        expect(transitions.apply).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'ASSIGNED' }));
      }

      cases.requireById.mockResolvedValue(caso({ status: 'WAITING_CUSTOMER' }) as never);
      await service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });
      expect(transitions.apply).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'WAITING_CUSTOMER' }));
    });

    it('la clave de idempotencia distingue caso, agente y momento', async () => {
      await service.assign({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(audit.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventCode: 'support.case.assigned', idempotencyKey: 'support-case-assigned-7-ag-1-12' }),
      );
    });
  });

  describe('transferir', () => {
    it('el resumen del que se va se deja ANTES de mover nada', async () => {
      const orden: string[] = [];
      enrutado.leaveHandoverSummary.mockImplementation(async () => {
        orden.push('resumen');
      });
      timeline.releaseLiveAssignment.mockImplementation(async () => {
        orden.push('liberar');
      });

      await service.transfer({
        tenantId: 't1',
        actor: AGENTE,
        caseId: '7',
        dto: { reason: 'no es lo mío', summary: 'ya probamos A y B' } as never,
      });

      expect(orden).toEqual(['resumen', 'liberar']);
      expect(enrutado.leaveHandoverSummary).toHaveBeenCalledWith('t1', '7', AGENTE, 'ya probamos A y B');
    });

    it('el agente que se va SALE de los canales del caso', async () => {
      cases.requireById.mockResolvedValue(caso({ currentAssigneeAgentId: 'ag-1' }) as never);

      await service.transfer({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(membership.leaveCaseChannels).toHaveBeenCalledWith('t1', '7', 'ag-1', 'x', expect.anything());
    });

    it('transferir a una PERSONA crea asignación de agente y lo mete en los canales', async () => {
      agents.findById.mockResolvedValueOnce({ id: 'ag-9', isActive: true, internalUserId: 9 } as never);

      await service.transfer({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x', agentProfileId: 'ag-9' } as never });

      expect(timeline.createAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeType: 'AGENT', assigneeAgentProfileId: 'ag-9' }),
        expect.anything(),
      );
      expect(membership.joinCaseChannels).toHaveBeenCalledWith(expect.objectContaining({ agentProfileId: 'ag-9' }), expect.anything());
      expect(transitions.apply).toHaveBeenCalledWith(expect.objectContaining({ to: 'ASSIGNED' }));
    });

    it('si esa persona ya no existe, la transferencia no se aborta: la asignación queda escrita', async () => {
      agents.findById.mockResolvedValueOnce(null as never);

      await expect(
        service.transfer({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x', agentProfileId: 'ag-9' } as never }),
      ).resolves.toBeDefined();
      expect(membership.joinCaseChannels).not.toHaveBeenCalled();
    });

    it('transferir a una COLA crea asignación de equipo y devuelve el caso a TRIAGED', async () => {
      await service.transfer({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x', queueCode: 'L2' } as never });

      expect(catalog.requireQueueByCode).toHaveBeenCalledWith('t1', 'L2');
      expect(timeline.createAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeType: 'TEAM', assigneeQueueId: '33' }),
        expect.anything(),
      );
      expect(transitions.apply).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'TRIAGED', extra: expect.objectContaining({ currentAssigneeAgentId: null, queueId: '33' }) }),
      );
    });

    it('sin persona ni cola no se crea asignación nueva: el caso queda liberado', async () => {
      await service.transfer({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(timeline.createAssignment).not.toHaveBeenCalled();
      expect(transitions.apply).toHaveBeenCalledWith(expect.objectContaining({ extra: expect.objectContaining({ queueId: 11 }) }));
    });

    it('cada transferencia suma al contador: es el indicador de «me pasaron de un lado a otro»', async () => {
      cases.requireById.mockResolvedValue(caso({ transferCount: 2 }) as never);

      await service.transfer({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(transitions.apply).toHaveBeenCalledWith(expect.objectContaining({ extra: expect.objectContaining({ transferCount: 3 }) }));
    });

    it('el motivo de la liberación deja constancia de que fue una transferencia', async () => {
      await service.transfer({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'no es lo mío' } as never });

      expect(timeline.releaseLiveAssignment).toHaveBeenCalledWith('7', 'transfer: no es lo mío', expect.anything());
    });
  });
});
