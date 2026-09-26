import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { SupportCaseClosureService } from '../../../src/modules/support/application/support-case-closure.service.js';
import type { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import type { SupportCaseTimelineRepository } from '../../../src/modules/support/support-case-timeline.repository.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportMessageService } from '../../../src/modules/support/application/support-message.service.js';
import type { SupportCaseTransitionService } from '../../../src/modules/support/application/support-case-transition.service.js';
import type { SupportSlaService } from '../../../src/modules/support/application/support-sla.service.js';
import type { SupportActorService, SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportAuditService } from '../../../src/modules/support/application/support-audit.service.js';
import type { SupportCaseModel } from '../../../src/database/models/index.js';

/**
 * El final del expediente: resolver, cerrar y reabrir.
 *
 * Cuatro reglas, todas sobre lo que NO se puede hacer.
 *
 * Resolver exige las DOS versiones de la resolución y la del cliente se le ENVÍA como mensaje: un
 * caso resuelto que el cliente no leyó sigue abierto para él. Un solo campo obligaría a elegir
 * entre ser útil dentro o publicable fuera, y siempre gana lo primero — así es como una nota con
 * jerga y datos de terceros acaba en la pantalla de alguien.
 *
 * Un bloqueo legal impide cerrar, y un caso sin resolución escrita también.
 *
 * El cierre AUTOMÁTICO está prohibido en seguridad, fraude, reclamo y privacidad: ahí convertir el
 * silencio de una persona en conformidad es exactamente lo que la empresa necesitaría que pasara, y
 * por eso no puede pasar solo.
 *
 * Y reabrir tiene ventana de 14 días: fuera de ella se abre un caso nuevo enlazado, porque un
 * expediente reabierto un año después mezcla dos problemas distintos y arruina la medición de los
 * dos.
 */
const AGENTE = { actorType: 'INTERNAL_USER', actorId: '7', agentProfileId: 'ag-1', isInternal: true } as unknown as SupportActor;

const RESOLUCION = {
  resolutionCode: 'FIXED',
  rootCauseCode: 'PROVIDER',
  customerResolution: 'Ya puedes entrar.',
  internalResolution: 'Cola del proveedor SMS atascada.',
} as never;

function caso(overrides: Record<string, unknown> = {}): SupportCaseModel {
  return {
    id: 7,
    caseNumber: 'SC-0007',
    status: 'RESOLVED',
    caseType: 'INCIDENT',
    legalHold: false,
    closedAt: null,
    reopenedCount: 0,
    lastEventSequence: 12,
    sensitivity: 'NORMAL',
    originContextJson: {},
    ...overrides,
  } as unknown as SupportCaseModel;
}

describe('SupportCaseClosureService', () => {
  let cases: { requireById: jest.Mock };
  let timeline: {
    nextResolutionSequence: jest.Mock;
    supersedeResolutions: jest.Mock;
    createResolution: jest.Mock;
    findCurrentResolution: jest.Mock;
  };
  let channels: { listChannelsForCase: jest.Mock };
  let messages: { append: jest.Mock };
  let transitions: { apply: jest.Mock };
  let sla: { satisfyClock: jest.Mock; cancelRunningClocks: jest.Mock };
  let actors: { assertIsAgent: jest.Mock; assertCanViewCase: jest.Mock };
  let audit: { publish: jest.Mock };
  let service: SupportCaseClosureService;

  beforeEach(() => {
    cases = { requireById: jest.fn(async () => caso()) };
    timeline = {
      nextResolutionSequence: jest.fn(async () => 1),
      supersedeResolutions: jest.fn(async () => undefined),
      createResolution: jest.fn(async () => ({ id: 1 })),
      findCurrentResolution: jest.fn(async () => ({ id: 1, resolutionCode: 'FIXED' })),
    };
    channels = { listChannelsForCase: jest.fn(async () => [{ id: 5, status: 'OPEN' }]) };
    messages = { append: jest.fn(async () => ({ id: 9 })) };
    transitions = { apply: jest.fn(async () => undefined) };
    sla = { satisfyClock: jest.fn(async () => undefined), cancelRunningClocks: jest.fn(async () => undefined) };
    actors = { assertIsAgent: jest.fn(() => 'ag-1'), assertCanViewCase: jest.fn(async () => undefined) };
    audit = { publish: jest.fn(async () => undefined) };

    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    service = new SupportCaseClosureService(
      sequelize,
      cases as unknown as SupportCaseRepository,
      timeline as unknown as SupportCaseTimelineRepository,
      channels as unknown as SupportChannelRepository,
      messages as unknown as SupportMessageService,
      transitions as unknown as SupportCaseTransitionService,
      sla as unknown as SupportSlaService,
      actors as unknown as SupportActorService,
      audit as unknown as SupportAuditService,
    );
  });

  describe('resolver', () => {
    it('es cosa del equipo: un cliente no resuelve su propio caso', async () => {
      actors.assertIsAgent.mockImplementationOnce(() => {
        throw new Error('SUPPORT_NOT_AN_AGENT');
      });

      await expect(service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION })).rejects.toThrow(
        'SUPPORT_NOT_AN_AGENT',
      );
    });

    it('supera la resolución anterior antes de escribir la nueva, con su número de secuencia', async () => {
      timeline.nextResolutionSequence.mockResolvedValueOnce(3 as never);

      await service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION });

      expect(timeline.supersedeResolutions).toHaveBeenCalled();
      expect(timeline.createResolution).toHaveBeenCalledWith(
        expect.objectContaining({ resolutionSequence: 3, resolutionCode: 'FIXED', resolvedByAgentId: 'ag-1' }),
        expect.anything(),
      );
    });

    it('guarda las DOS versiones: la del cliente y la interna, cada una en su sitio', async () => {
      await service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION });

      expect(timeline.createResolution).toHaveBeenCalledWith(
        expect.objectContaining({ customerResolution: 'Ya puedes entrar.', internalResolution: 'Cola del proveedor SMS atascada.' }),
        expect.anything(),
      );
      expect(transitions.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'RESOLVED',
          extra: expect.objectContaining({ publicSummary: 'Ya puedes entrar.', internalSummary: 'Cola del proveedor SMS atascada.' }),
        }),
      );
    });

    it('la resolución se COMUNICA: se envía al canal como mensaje público', async () => {
      await service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION });

      expect(messages.append).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: '5', body: 'Ya puedes entrar.', messageType: 'CASE_STATUS_UPDATE', visibility: 'PUBLIC' }),
      );
    });

    it('se prefiere un canal VIVO y no uno cerrado, aunque el cerrado sea el primero', async () => {
      channels.listChannelsForCase.mockResolvedValueOnce([
        { id: 1, status: 'CLOSED' },
        { id: 2, status: 'WAITING_USER' },
      ] as never);

      await service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION });

      expect(messages.append).toHaveBeenCalledWith(expect.objectContaining({ channelId: '2' }));
    });

    it('sin ningún canal vivo se usa el que haya: la resolución no se pierde por no tener dónde ponerla', async () => {
      channels.listChannelsForCase.mockResolvedValueOnce([{ id: 1, status: 'CLOSED' }] as never);

      await service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION });

      expect(messages.append).toHaveBeenCalledWith(expect.objectContaining({ channelId: '1' }));
    });

    it('sin canales no se rompe: el caso queda resuelto igual', async () => {
      channels.listChannelsForCase.mockResolvedValueOnce([] as never);

      await expect(service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION })).resolves.toBeDefined();
      expect(messages.append).not.toHaveBeenCalled();
    });

    it('detiene el reloj de RESOLUCIÓN y publica el evento con clave de idempotencia', async () => {
      await service.resolve({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: RESOLUCION });

      expect(sla.satisfyClock).toHaveBeenCalledWith(expect.objectContaining({ metricType: 'RESOLUTION', caseId: '7' }));
      expect(audit.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventCode: 'support.case.resolved', idempotencyKey: 'support-case-resolved-7-12' }),
      );
    });
  });

  describe('cerrar', () => {
    it('un bloqueo legal lo impide, y se comprueba antes de tocar el caso', async () => {
      cases.requireById.mockResolvedValueOnce(caso({ legalHold: true }) as never);

      await expect(service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'ok' } as never })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(transitions.apply).not.toHaveBeenCalled();
    });

    it('sin resolución escrita no se cierra: «documenta la resolución antes de cerrar»', async () => {
      timeline.findCurrentResolution.mockResolvedValueOnce(null as never);

      await expect(service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'ok' } as never })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('un DUPLICADO sí se cierra sin resolución propia: la explicación está en el caso al que se unió', async () => {
      cases.requireById.mockResolvedValue(caso({ status: 'DUPLICATE' }) as never);
      timeline.findCurrentResolution.mockResolvedValueOnce(null as never);

      await expect(service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'unido' } as never })).resolves.toBeDefined();
    });

    it('el cierre automático NO exige ser agente: lo dispara el barrido', async () => {
      await service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'silencio' } as never, automatic: true });

      expect(actors.assertIsAgent).not.toHaveBeenCalled();
    });

    it('pero el automático está prohibido en fraude, seguridad, reclamo y privacidad', async () => {
      for (const tipo of ['SECURITY_INCIDENT', 'FRAUD_REPORT', 'COMPLAINT']) {
        cases.requireById.mockResolvedValueOnce(caso({ caseType: tipo }) as never);

        await expect(
          service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'silencio' } as never, automatic: true }),
        ).rejects.toBeInstanceOf(ConflictException);
      }
      expect(transitions.apply).not.toHaveBeenCalled();
    });

    it('un cierre MANUAL de esos mismos tipos sí se permite: lo decide una persona', async () => {
      cases.requireById.mockResolvedValue(caso({ caseType: 'FRAUD_REPORT' }) as never);

      await expect(
        service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'resuelto' } as never }),
      ).resolves.toBeDefined();
    });

    it('cerrar detiene el reloj de cierre y CANCELA los que siguieran corriendo', async () => {
      await service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'ok' } as never });

      expect(sla.satisfyClock).toHaveBeenCalledWith(expect.objectContaining({ metricType: 'CLOSE' }));
      expect(sla.cancelRunningClocks).toHaveBeenCalledWith('7', expect.anything());
      expect(audit.publish).toHaveBeenCalledWith(expect.objectContaining({ eventCode: 'support.case.closed' }));
    });

    it('el evento deja constancia de si el cierre fue automático', async () => {
      await service.close({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'silencio' } as never, automatic: true });

      expect(transitions.apply).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'CLOSED', payload: { reason: 'silencio', automatic: true } }),
      );
    });
  });

  describe('reabrir', () => {
    it('exige poder ver el caso: no se reabre lo que no se puede leer', async () => {
      actors.assertCanViewCase.mockRejectedValueOnce(new Error('SUPPORT_CASE_FORBIDDEN') as never);

      await expect(service.reopen({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never })).rejects.toThrow(
        'SUPPORT_CASE_FORBIDDEN',
      );
    });

    it('dentro de la ventana reabre, incrementa el contador y borra las fechas de cierre y resolución', async () => {
      cases.requireById.mockResolvedValue(
        caso({ status: 'REOPENED', closedAt: new Date(Date.now() - 3 * 86_400_000), reopenedCount: 1 }) as never,
      );

      const resultado = await service.reopen({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'volvió a pasar' } as never });

      expect(transitions.apply).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'REOPENED', extra: { reopenedCount: 2, closedAt: null, resolvedAt: null } }),
      );
      expect(resultado).toMatchObject({ caseId: '7', reopenedCount: 1, status: 'REOPENED' });
    });

    it('pasados los 14 días es 409 y se pide abrir un caso nuevo enlazado', async () => {
      cases.requireById.mockResolvedValueOnce(caso({ closedAt: new Date(Date.now() - 20 * 86_400_000) }) as never);

      const fallo = await service
        .reopen({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never })
        .catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ConflictException);
      expect((fallo as ConflictException).getResponse()).toMatchObject({ code: 'SUPPORT_REOPEN_WINDOW_EXPIRED', windowDays: 14 });
      expect(transitions.apply).not.toHaveBeenCalled();
    });

    it('un caso que nunca se cerró no tiene ventana que agotar', async () => {
      cases.requireById.mockResolvedValue(caso({ closedAt: null }) as never);

      await expect(service.reopen({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never })).resolves.toBeDefined();
    });

    it('la clave de idempotencia usa el contador de reaperturas: dos reaperturas son dos eventos', async () => {
      cases.requireById.mockResolvedValue(caso({ reopenedCount: 2, status: 'REOPENED' }) as never);

      await service.reopen({ tenantId: 't1', actor: AGENTE, caseId: '7', dto: { reason: 'x' } as never });

      expect(audit.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventCode: 'support.case.reopened', idempotencyKey: 'support-case-reopened-7-2' }),
      );
    });
  });
});
