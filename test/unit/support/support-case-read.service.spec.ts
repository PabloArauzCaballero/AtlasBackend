import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { SupportCaseReadService } from '../../../src/modules/support/application/support-case-read.service.js';
import type { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import type { SupportCaseTimelineRepository } from '../../../src/modules/support/support-case-timeline.repository.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportActorService, SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportAuditService } from '../../../src/modules/support/application/support-audit.service.js';
import type { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';
import type { SupportCaseModel } from '../../../src/database/models/index.js';

/**
 * La LECTURA de expedientes de soporte.
 *
 * Cuatro decisiones, y las cuatro fallan devolviendo datos —nunca un error—.
 *
 * Cada lectura interna se AUDITA, porque el acceso por curiosidad a un expediente que no se tiene
 * asignado no deja ninguna otra huella: no cambia nada en el caso. Es exactamente el comportamiento
 * que hay que poder detectar después, y sin la auditoría es indetectable por construcción.
 *
 * El filtro por sujeto de «mis casos» lo pone el SERVIDOR y nunca la petición.
 *
 * Un `categoryCode` mal escrito es 404 y no un filtro ignorado: ignorarlo devolvería la cola ENTERA
 * con cara de estar filtrada, y quien mira la pantalla creería ver los casos de ese motivo estando
 * viendo todos. Es el peor fallo posible de un filtro, porque no da error: da un número equivocado.
 *
 * Y la cola ordena por prioridad Y antigüedad: sin la antigüedad, un flujo constante de P3 nuevos
 * deja los P3 viejos al final para siempre.
 */
const CLIENTE = { actorType: 'CUSTOMER', actorId: '42', customerId: '42', isInternal: false, isSupervisor: false } as SupportActor;
const AGENTE = {
  actorType: 'INTERNAL_USER',
  actorId: '7',
  agentProfileId: 'ag-1',
  isInternal: true,
  isSupervisor: false,
} as unknown as SupportActor;
const SUPERVISOR = { ...AGENTE, isSupervisor: true } as SupportActor;

function caso(overrides: Record<string, unknown> = {}): SupportCaseModel {
  return {
    id: 7,
    caseNumber: 'SC-0007',
    status: 'IN_PROGRESS',
    sensitivity: 'NORMAL',
    currentAssigneeAgentId: 'ag-1',
    openedAt: new Date('2026-09-01T10:00:00Z'),
    reopenedCount: 0,
    originContextJson: {},
    ...overrides,
  } as unknown as SupportCaseModel;
}

describe('SupportCaseReadService', () => {
  let cases: { requireById: jest.Mock; listEvents: jest.Mock; listCases: jest.Mock };
  let timeline: {
    listAssignments: jest.Mock;
    listClocks: jest.Mock;
    findCurrentResolution: jest.Mock;
    listLinks: jest.Mock;
    listReferences: jest.Mock;
  };
  let channels: { listChannelsForCase: jest.Mock };
  let actors: { assertCanViewCase: jest.Mock; assertIsAgent: jest.Mock };
  let audit: { record: jest.Mock };
  let catalog: { findCategoryByCode: jest.Mock };
  let service: SupportCaseReadService;

  beforeEach(() => {
    cases = {
      requireById: jest.fn(async () => caso()),
      listEvents: jest.fn(async () => []),
      listCases: jest.fn(async () => []),
    };
    timeline = {
      listAssignments: jest.fn(async () => []),
      listClocks: jest.fn(async () => []),
      findCurrentResolution: jest.fn(async () => null),
      listLinks: jest.fn(async () => []),
      listReferences: jest.fn(async () => []),
    };
    channels = { listChannelsForCase: jest.fn(async () => []) };
    actors = { assertCanViewCase: jest.fn(async () => undefined), assertIsAgent: jest.fn(() => 'ag-1') };
    audit = { record: jest.fn(async () => undefined) };
    catalog = { findCategoryByCode: jest.fn(async () => null) };
    service = new SupportCaseReadService(
      cases as unknown as SupportCaseRepository,
      timeline as unknown as SupportCaseTimelineRepository,
      channels as unknown as SupportChannelRepository,
      actors as unknown as SupportActorService,
      audit as unknown as SupportAuditService,
      catalog as unknown as SupportCatalogRepository,
    );
  });

  describe('detalle del caso', () => {
    it('la autorización va ANTES de leer nada más', async () => {
      await service.getCase({ tenantId: 't1', actor: CLIENTE, caseId: '7' });

      expect(actors.assertCanViewCase).toHaveBeenCalledWith(CLIENTE, expect.anything(), 't1');
    });

    it('el cliente recibe la proyección del cliente, sin nada operativo', async () => {
      const dto = await service.getCase({ tenantId: 't1', actor: CLIENTE, caseId: '7' });

      expect(dto).not.toHaveProperty('internalStatus');
      expect(dto).not.toHaveProperty('queueId');
      expect(dto).toHaveProperty('caseNumber', 'SC-0007');
    });

    it('el equipo recibe la operativa y su lectura QUEDA AUDITADA: es la única huella de la curiosidad', async () => {
      const dto = await service.getCase({ tenantId: 't1', actor: AGENTE, caseId: '7' });

      expect(dto).toHaveProperty('internalStatus', 'IN_PROGRESS');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actionCode: 'support.case.read', targetType: 'support_case', targetId: '7' }),
      );
    });

    it('la lectura del cliente NO se audita: es su propio caso, no hay curiosidad que detectar', async () => {
      await service.getCase({ tenantId: 't1', actor: CLIENTE, caseId: '7' });

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('los canales llegan reducidos a lo pintable, sin la fila entera', async () => {
      channels.listChannelsForCase.mockResolvedValueOnce([
        { id: 5, status: 'OPEN', channelType: 'CHAT', assignedAgentProfileId: 33 },
      ] as never);

      const dto = await service.getCase({ tenantId: 't1', actor: CLIENTE, caseId: '7' });

      expect(dto.channels).toEqual([{ channelId: '5', status: 'OPEN', type: 'CHAT' }]);
    });
  });

  describe('historia del expediente', () => {
    it('es sólo para el equipo: se exige ser agente además de poder ver el caso', async () => {
      actors.assertIsAgent.mockImplementationOnce(() => {
        throw new Error('SUPPORT_NOT_AN_AGENT');
      });

      await expect(service.getTimeline({ tenantId: 't1', actor: CLIENTE, caseId: '7' })).rejects.toThrow('SUPPORT_NOT_AN_AGENT');
    });

    it('trae eventos, asignaciones, relojes, resolución, enlaces y referencias, y se audita', async () => {
      const historia = await service.getTimeline({ tenantId: 't1', actor: AGENTE, caseId: '7' });

      expect(historia).toMatchObject({ events: [], assignments: [], sla: [], resolution: null, links: [], references: [] });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actionCode: 'support.case.timeline_read' }));
    });

    it('los relojes de SLA salen con sus fechas en ISO y las no ocurridas como nulo', async () => {
      timeline.listClocks.mockResolvedValueOnce([
        {
          metricType: 'FIRST_RESPONSE',
          state: 'RUNNING',
          startedAt: new Date('2026-09-01T10:00:00Z'),
          targetAt: new Date('2026-09-01T14:00:00Z'),
          satisfiedAt: null,
          breachedAt: null,
          totalPausedSeconds: 120,
        },
      ] as never);

      const historia = await service.getTimeline({ tenantId: 't1', actor: AGENTE, caseId: '7' });

      expect(historia.sla[0]).toEqual({
        metric: 'FIRST_RESPONSE',
        state: 'RUNNING',
        startedAt: '2026-09-01T10:00:00.000Z',
        targetAt: '2026-09-01T14:00:00.000Z',
        satisfiedAt: null,
        breachedAt: null,
        totalPausedSeconds: 120,
      });
    });

    it('la resolución vigente llega con sus dos textos: el del cliente y el interno', async () => {
      timeline.findCurrentResolution.mockResolvedValueOnce({
        resolutionCode: 'FIXED',
        rootCauseCode: 'PROVIDER',
        customerResolution: 'Ya puedes entrar.',
        internalResolution: 'Cola del proveedor SMS atascada.',
        resolvedAt: new Date('2026-09-02T10:00:00Z'),
      } as never);

      const historia = await service.getTimeline({ tenantId: 't1', actor: AGENTE, caseId: '7' });

      expect(historia.resolution).toEqual({
        resolutionCode: 'FIXED',
        rootCauseCode: 'PROVIDER',
        customerResolution: 'Ya puedes entrar.',
        internalResolution: 'Cola del proveedor SMS atascada.',
        resolvedAt: '2026-09-02T10:00:00.000Z',
      });
    });

    it('los enlaces llevan los dos extremos como texto', async () => {
      timeline.listLinks.mockResolvedValueOnce([{ caseId: 7, linkedCaseId: 9, linkType: 'DUPLICATE', note: null }] as never);

      const historia = await service.getTimeline({ tenantId: 't1', actor: AGENTE, caseId: '7' });

      expect(historia.links).toEqual([{ caseId: '7', linkedCaseId: '9', linkType: 'DUPLICATE', note: null }]);
    });
  });

  describe('mis casos', () => {
    it('el filtro por sujeto lo pone el SERVIDOR desde el actor, no la petición', async () => {
      await service.listOwnCases({ tenantId: 't1', actor: CLIENTE, query: { limit: 20 } as never });

      expect(cases.listCases).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', customerId: '42', partnerProfileId: null, openedByActorId: null }),
      );
    });

    it('un empleado del comercio ve los que ÉL abrió, no los de su empresa entera', async () => {
      const empleado = { actorType: 'PARTNER_USER', actorId: 'u-9', isInternal: false } as unknown as SupportActor;

      await service.listOwnCases({ tenantId: 't1', actor: empleado, query: { limit: 20 } as never, partnerProfileId: 'pp-1' });

      expect(cases.listCases).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: null, partnerProfileId: 'pp-1', openedByActorId: 'u-9' }),
      );
    });

    it('los estados llegan como lista separada por comas, y sin ellos no se filtra', async () => {
      await service.listOwnCases({ tenantId: 't1', actor: CLIENTE, query: { limit: 20, status: 'NEW,CLOSED' } as never });
      expect(cases.listCases).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['NEW', 'CLOSED'] }));

      await service.listOwnCases({ tenantId: 't1', actor: CLIENTE, query: { limit: 20 } as never });
      expect(cases.listCases).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: undefined }));
    });

    it('la vista del cliente es la del cliente aunque la consulta la haga otro', async () => {
      cases.listCases.mockResolvedValueOnce([caso()] as never);

      const pagina = await service.listOwnCases({ tenantId: 't1', actor: CLIENTE, query: { limit: 20 } as never });

      expect(pagina.cases[0]).not.toHaveProperty('internalStatus');
    });

    it('no hay cursor siguiente cuando la página no se llenó', async () => {
      cases.listCases.mockResolvedValueOnce([caso()] as never);

      const pagina = await service.listOwnCases({ tenantId: 't1', actor: CLIENTE, query: { limit: 20 } as never });
      expect(pagina.nextCursor).toBeNull();
    });

    it('con la página llena, el cursor apunta al último caso y no al primero', async () => {
      cases.listCases.mockResolvedValueOnce([
        caso({ id: 1, openedAt: new Date('2026-09-05T10:00:00Z') }),
        caso({ id: 2, openedAt: new Date('2026-09-01T10:00:00Z') }),
      ] as never);

      const pagina = await service.listOwnCases({ tenantId: 't1', actor: CLIENTE, query: { limit: 2 } as never });

      expect(pagina.nextCursor).toEqual({ openedAt: '2026-09-01T10:00:00.000Z', id: '2' });
    });
  });

  describe('cola de trabajo', () => {
    it('sin filtro de estado se ve todo lo VIVO, no todo el histórico', async () => {
      await service.listWorkQueue({ tenantId: 't1', actor: AGENTE, query: { limit: 20 } as never });

      const enviado = cases.listCases.mock.calls.at(-1)?.[0] as { statuses: string[] };
      expect(enviado.statuses).not.toContain('CLOSED');
      expect(enviado.statuses).toContain('NEW');
      expect(enviado.statuses).toContain('ESCALATED');
    });

    it('«asignados a mí» resuelve al perfil del agente y no a su id de usuario', async () => {
      await service.listWorkQueue({ tenantId: 't1', actor: AGENTE, query: { limit: 20, assignedToMe: true } as never });

      expect(cases.listCases).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeAgentId: 'ag-1' }));
    });

    it('un motivo que no existe es 404 y no un filtro ignorado que devolvería la cola entera', async () => {
      catalog.findCategoryByCode.mockResolvedValueOnce(null as never);

      await expect(
        service.listWorkQueue({ tenantId: 't1', actor: AGENTE, query: { limit: 20, categoryCode: 'MAL_ESCRITO' } as never }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cases.listCases).not.toHaveBeenCalled();
    });

    it('un motivo que existe se traduce a su identificador', async () => {
      catalog.findCategoryByCode.mockResolvedValueOnce({ id: 22 } as never);

      await service.listWorkQueue({ tenantId: 't1', actor: AGENTE, query: { limit: 20, categoryCode: 'AUTH' } as never });

      expect(cases.listCases).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: '22' }));
    });

    it('un caso RESTRINGIDO no aparece para quien no lo tiene asignado', async () => {
      cases.listCases.mockResolvedValueOnce([
        caso({ id: 1, sensitivity: 'RESTRICTED', currentAssigneeAgentId: 'ag-otro' }),
        caso({ id: 2, sensitivity: 'NORMAL', currentAssigneeAgentId: 'ag-otro' }),
      ] as never);

      const cola = await service.listWorkQueue({ tenantId: 't1', actor: AGENTE, query: { limit: 20 } as never });

      expect(cola.cases.map((c) => c.caseId)).toEqual(['2']);
    });

    it('sí aparece para quien lo tiene asignado y para un supervisor', async () => {
      cases.listCases.mockResolvedValueOnce([caso({ id: 1, sensitivity: 'RESTRICTED', currentAssigneeAgentId: 'ag-1' })] as never);
      const propio = await service.listWorkQueue({ tenantId: 't1', actor: AGENTE, query: { limit: 20 } as never });
      expect(propio.cases).toHaveLength(1);

      cases.listCases.mockResolvedValueOnce([caso({ id: 1, sensitivity: 'RESTRICTED', currentAssigneeAgentId: 'ag-otro' })] as never);
      const supervisado = await service.listWorkQueue({ tenantId: 't1', actor: SUPERVISOR, query: { limit: 20 } as never });
      expect(supervisado.cases).toHaveLength(1);
    });

    it('el cursor se calcula sobre lo LEÍDO y no sobre lo visible: si no, filtrar un restringido cortaría la paginación', async () => {
      cases.listCases.mockResolvedValueOnce([
        caso({ id: 1, sensitivity: 'RESTRICTED', currentAssigneeAgentId: 'ag-otro' }),
        caso({ id: 2, openedAt: new Date('2026-09-01T10:00:00Z') }),
      ] as never);

      const cola = await service.listWorkQueue({ tenantId: 't1', actor: AGENTE, query: { limit: 2 } as never });

      expect(cola.cases).toHaveLength(1);
      expect(cola.nextCursor).toEqual({ openedAt: '2026-09-01T10:00:00.000Z', id: '2' });
    });
  });
});
