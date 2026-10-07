import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import { SupportCaseEscalationService } from '../../../src/modules/support/application/support-case-escalation.service.js';
import type { SupportActor, SupportActorService } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportAuditService } from '../../../src/modules/support/application/support-audit.service.js';
import type { SupportCaseTransitionService } from '../../../src/modules/support/application/support-case-transition.service.js';
import type { SupportMessageService } from '../../../src/modules/support/application/support-message.service.js';
import type { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import type { SupportCaseTimelineRepository } from '../../../src/modules/support/support-case-timeline.repository.js';
import type { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';

/**
 * Escalar, anotar y enlazar escriben en el expediente: pasan por la misma regla que abrirlo. Antes
 * sólo la lectura miraba `RESTRICTED`, así que un agente sin asignación anotaba o enlazaba un caso
 * de fraude que no podía leer.
 */
const AGENTE = {
  actorType: 'AGENT',
  actorId: '7',
  agentProfileId: 'ag-1',
  isInternal: true,
  isSupervisor: false,
} as unknown as SupportActor;
const RESTRINGIDO = new ForbiddenException({ code: 'SUPPORT_CASE_RESTRICTED' });

function caso(overrides: Record<string, unknown> = {}) {
  return { id: '7', escalationLevel: 0, queueId: 'q-1', sensitivity: 'NORMAL', priority: 'P3', ...overrides };
}

describe('SupportCaseEscalationService', () => {
  let cases: { requireById: jest.Mock; appendEvent: jest.Mock };
  let timeline: { releaseLiveAssignment: jest.Mock; createLink: jest.Mock };
  let channels: { listChannelsForCase: jest.Mock };
  let messages: { append: jest.Mock };
  let transitions: { apply: jest.Mock };
  let actors: { assertIsAgent: jest.Mock; assertCanViewCase: jest.Mock };
  let audit: { publish: jest.Mock };
  let service: SupportCaseEscalationService;

  beforeEach(() => {
    const sequelize = { transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn({})) };
    cases = {
      requireById: jest.fn(async (...args: unknown[]) => caso({ id: String(args[1]) })),
      appendEvent: jest.fn(async () => undefined),
    };
    timeline = { releaseLiveAssignment: jest.fn(async () => undefined), createLink: jest.fn(async () => undefined) };
    channels = { listChannelsForCase: jest.fn(async () => [{ id: 'ch-1', status: 'ACTIVE' }]) };
    messages = { append: jest.fn(async () => ({ id: 'm-1' })) };
    transitions = { apply: jest.fn(async () => undefined) };
    actors = { assertIsAgent: jest.fn(() => 'ag-1'), assertCanViewCase: jest.fn(async () => undefined) };
    audit = { publish: jest.fn(async () => undefined) };
    const catalog = { findQueueByCode: jest.fn(async () => ({ id: 'q-9' })) };

    service = new SupportCaseEscalationService(
      sequelize as unknown as Sequelize,
      cases as unknown as SupportCaseRepository,
      timeline as unknown as SupportCaseTimelineRepository,
      catalog as unknown as SupportCatalogRepository,
      channels as unknown as SupportChannelRepository,
      messages as unknown as SupportMessageService,
      transitions as unknown as SupportCaseTransitionService,
      actors as unknown as SupportActorService,
      audit as unknown as SupportAuditService,
    );
  });

  it('escalar un caso que no se puede abrir es 403 y no suelta a su responsable', async () => {
    actors.assertCanViewCase.mockRejectedValueOnce(RESTRINGIDO as never);

    await expect(
      service.escalate({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { escalationType: 'FUNCTIONAL', reason: 'x' } as never }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(timeline.releaseLiveAssignment).not.toHaveBeenCalled();
    expect(transitions.apply).not.toHaveBeenCalled();
  });

  it('escalar a seguridad un caso que sí se puede abrir lo deja RESTRINGIDO', async () => {
    await service.escalate({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { escalationType: 'FRAUD', reason: 'x' } as never });

    expect(actors.assertCanViewCase).toHaveBeenCalledWith(AGENTE, expect.objectContaining({ id: '7' }), 't1');
    expect(transitions.apply).toHaveBeenCalledWith(
      expect.objectContaining({ extra: expect.objectContaining({ sensitivity: 'RESTRICTED' }) }),
    );
  });

  it('anotar un caso que no se puede abrir es 403 y no escribe la nota', async () => {
    actors.assertCanViewCase.mockRejectedValueOnce(RESTRINGIDO as never);

    await expect(
      service.addInternalNote({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { body: 'nota' } as never }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(messages.append).not.toHaveBeenCalled();
  });

  it('la nota de un caso visible se escribe como INTERNAL', async () => {
    await expect(service.addInternalNote({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { body: 'nota' } as never })).resolves.toEqual({
      messageId: 'm-1',
      visibility: 'INTERNAL',
    });
  });

  it('enlazar exige poder abrir los DOS extremos', async () => {
    actors.assertCanViewCase.mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(RESTRINGIDO as never);

    await expect(
      service.link({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { linkedCaseId: '9', linkType: 'RELATED' } as never }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(actors.assertCanViewCase).toHaveBeenNthCalledWith(2, AGENTE, expect.objectContaining({ id: '9' }), 't1');
    expect(timeline.createLink).not.toHaveBeenCalled();
  });

  it('con los dos extremos visibles el enlace se escribe', async () => {
    await service.link({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { linkedCaseId: '9', linkType: 'RELATED' } as never });

    expect(timeline.createLink).toHaveBeenCalledWith(expect.objectContaining({ caseId: '7', linkedCaseId: '9' }), expect.anything());
  });
});
