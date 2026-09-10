import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { SupportChannelService } from '../../../src/modules/support/application/support-channel.service.js';
import { SUPPORT_NEVER_ASKS_WARNING } from '../../../src/modules/support/domain/message-dlp.js';
import { SUPPORT_QUEUE_CODES } from '../../../src/modules/support/support.constants.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';
import type { SupportAgentRepository } from '../../../src/modules/support/support-agent.repository.js';
import type { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import type { SupportMessageService } from '../../../src/modules/support/application/support-message.service.js';
import type { SupportActorService, SupportActor } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportAuditService } from '../../../src/modules/support/application/support-audit.service.js';
import type { SupportCaseService } from '../../../src/modules/support/application/support-case.service.js';
import type { SupportChannelCreationService } from '../../../src/modules/support/application/support-channel-creation.service.js';
import type { SupportAgentAvailabilityRepository } from '../../../src/modules/support/support-agent-availability.repository.js';

/**
 * Abrir, tomar y cerrar el canal de atención.
 *
 * Cuatro decisiones de producto que se pierden en cuanto alguien «simplifica» el flujo.
 *
 * Si no hay nadie libre, el canal SE CREA IGUAL en `QUEUED` y la respuesta dice cuántos agentes hay.
 * Bloquear con «no hay agentes, intente más tarde» es lo que empuja a la gente a escribir por redes
 * sociales, donde nada de esto queda registrado.
 *
 * Se reutiliza el canal vivo del mismo solicitante, sin error: abrir soporte desde dos pantallas no
 * debe crear dos conversaciones, y el usuario no hizo nada mal.
 *
 * El aviso de seguridad lo manda el SISTEMA y no el agente, así aparece siempre — incluso a las once
 * de la noche, cuando quien atiende está cansado y no se acuerda de escribirlo.
 *
 * Y cerrar el canal NO cierra el caso: quien cierra el chat puede haberse quedado sin batería. El
 * expediente sigue su ciclo y alguien tendrá que resolverlo.
 */
const CLIENTE = { actorType: 'CUSTOMER', actorId: '42', customerId: '42', agentProfileId: null } as SupportActor;
const AGENTE = { actorType: 'AGENT', actorId: '7', agentProfileId: 'ag-1' } as SupportActor;

function canal(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    status: 'QUEUED',
    queueId: 11,
    caseId: 'caso-1',
    claimVersion: 0,
    assignedAgentProfileId: null,
    lastMessageSequence: 0,
    requestedAt: new Date('2026-09-10T10:00:00Z'),
    openedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('SupportChannelService', () => {
  let channels: {
    findLiveChannelForCustomer: jest.Mock;
    findLiveChannelForPartnerUser: jest.Mock;
    requireById: jest.Mock;
    update: jest.Mock;
    addParticipant: jest.Mock;
    listParticipants: jest.Mock;
    removeParticipant: jest.Mock;
  };
  let catalog: { findCategoryByCode: jest.Mock; findQueueById: jest.Mock; findQueueByCode: jest.Mock };
  let cases: { appendEvent: jest.Mock };
  let messages: { append: jest.Mock };
  let actors: { assertIsAgent: jest.Mock };
  let audit: { publish: jest.Mock };
  let apertura: { persistRequestedChannel: jest.Mock };
  let disponibilidad: { reserveAvailableAgent: jest.Mock; countAvailable: jest.Mock; releaseAgentSlot: jest.Mock };
  let service: SupportChannelService;

  beforeEach(() => {
    channels = {
      findLiveChannelForCustomer: jest.fn(async () => null),
      findLiveChannelForPartnerUser: jest.fn(async () => null),
      requireById: jest.fn(async () => canal()),
      update: jest.fn(async () => undefined),
      addParticipant: jest.fn(async () => ({ id: 'p-1' })),
      listParticipants: jest.fn(async () => []),
      removeParticipant: jest.fn(async () => undefined),
    };
    catalog = {
      findCategoryByCode: jest.fn(async () => null),
      findQueueById: jest.fn(async () => ({ id: 22, skillsRequiredJson: ['qr'] })),
      findQueueByCode: jest.fn(async () => ({ id: 11, skillsRequiredJson: null })),
    };
    cases = { appendEvent: jest.fn(async () => ({ id: 1 })) };
    messages = { append: jest.fn(async () => ({ id: 9 })) };
    actors = { assertIsAgent: jest.fn(() => 'ag-1') };
    audit = { publish: jest.fn(async () => undefined) };
    apertura = { persistRequestedChannel: jest.fn(async () => canal()) };
    disponibilidad = {
      reserveAvailableAgent: jest.fn(async () => ({ agentProfileId: 'ag-1' })),
      countAvailable: jest.fn(async () => 3),
      releaseAgentSlot: jest.fn(async () => undefined),
    };

    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    service = new SupportChannelService(
      sequelize,
      channels as unknown as SupportChannelRepository,
      catalog as unknown as SupportCatalogRepository,
      {} as unknown as SupportAgentRepository,
      cases as unknown as SupportCaseRepository,
      messages as unknown as SupportMessageService,
      actors as unknown as SupportActorService,
      audit as unknown as SupportAuditService,
      {} as unknown as SupportCaseService,
      apertura as unknown as SupportChannelCreationService,
      disponibilidad as unknown as SupportAgentAvailabilityRepository,
    );
  });

  describe('pedir atención', () => {
    it('reutiliza el canal vivo del cliente en vez de abrir otro, y lo declara', async () => {
      channels.findLiveChannelForCustomer.mockResolvedValueOnce(canal({ id: 3, status: 'OPEN' }) as never);

      const resultado = await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });

      expect(resultado).toMatchObject({ channelId: '3', reused: true, agentsAvailable: null });
      expect(apertura.persistRequestedChannel).not.toHaveBeenCalled();
      expect(messages.append).not.toHaveBeenCalled();
    });

    it('el del empleado del comercio se busca con SU identificador, no con el de la empresa', async () => {
      const empleado = { actorType: 'PARTNER_USER', actorId: 'u-9' } as SupportActor;

      await service.requestChannel({ tenantId: 't1', actor: empleado, dto: { partnerProfileId: 'pp-1' } as never });

      expect(channels.findLiveChannelForPartnerUser).toHaveBeenCalledWith('t1', 'pp-1', 'u-9');
    });

    it('sin motivo, la cola por defecto depende de quién pide: consumidor o comercio', async () => {
      await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });
      expect(catalog.findQueueByCode).toHaveBeenLastCalledWith('t1', SUPPORT_QUEUE_CODES.CONSUMER_L1);

      await service.requestChannel({
        tenantId: 't1',
        actor: { actorType: 'PARTNER_USER', actorId: 'u-9' } as SupportActor,
        dto: {} as never,
      });
      expect(catalog.findQueueByCode).toHaveBeenLastCalledWith('t1', SUPPORT_QUEUE_CODES.PARTNER_L1);
    });

    it('con motivo que tiene cola propia, manda la del motivo y con ella sus destrezas', async () => {
      catalog.findCategoryByCode.mockResolvedValueOnce({ id: 1, defaultQueueId: 22 } as never);

      await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: { categoryCode: 'QR' } as never });

      expect(catalog.findQueueById).toHaveBeenCalledWith('t1', '22');
      expect(disponibilidad.reserveAvailableAgent).toHaveBeenCalledWith({ tenantId: 't1', queueId: '22', requiredSkills: ['qr'] });
    });

    it('una cola sin destrezas declaradas no reserva con `undefined`', async () => {
      await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });

      expect(disponibilidad.reserveAvailableAgent).toHaveBeenCalledWith(expect.objectContaining({ requiredSkills: [] }));
    });

    it('sin nadie libre el canal SE CREA IGUAL y se dice cuántos agentes hay', async () => {
      disponibilidad.reserveAvailableAgent.mockResolvedValueOnce(null as never);
      apertura.persistRequestedChannel.mockResolvedValueOnce(canal({ status: 'QUEUED' }) as never);

      const resultado = await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });

      expect(resultado).toMatchObject({ reused: false, agentsAvailable: 3 });
      expect(disponibilidad.countAvailable).toHaveBeenCalledWith('t1', '11');
    });

    it('con agente reservado no se cuenta la disponibilidad: el dato no aporta nada', async () => {
      const resultado = await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });

      expect(resultado.agentsAvailable).toBeNull();
      expect(disponibilidad.countAvailable).not.toHaveBeenCalled();
    });

    it('el aviso de seguridad lo manda el SISTEMA, no el agente ni el cliente', async () => {
      await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });

      expect(messages.append).toHaveBeenCalledWith(
        expect.objectContaining({
          body: SUPPORT_NEVER_ASKS_WARNING,
          messageType: 'SECURITY_WARNING',
          visibility: 'SYSTEM',
          actor: expect.objectContaining({ actorType: 'SYSTEM', actorId: 'system' }),
        }),
      );
    });

    it('el aviso lleva un identificador derivado del canal: reintentarlo no lo duplica', async () => {
      await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });

      expect(messages.append).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: 'warning-5' }));
    });

    it('se publica la apertura con clave de idempotencia y si quedó asignado o no', async () => {
      await service.requestChannel({ tenantId: 't1', actor: CLIENTE, dto: {} as never });

      expect(audit.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventCode: 'support.channel.opened',
          idempotencyKey: 'support-channel-opened-5',
          payload: expect.objectContaining({ assigned: true }),
        }),
      );
    });
  });

  describe('tomar un canal', () => {
    it('sólo un agente habilitado lo toma', async () => {
      actors.assertIsAgent.mockImplementationOnce(() => {
        throw new Error('SUPPORT_AGENT_PROFILE_REQUIRED');
      });

      await expect(service.claimChannel({ tenantId: 't1', actor: AGENTE, channelId: '5' })).rejects.toThrow(
        'SUPPORT_AGENT_PROFILE_REQUIRED',
      );
    });

    it('un canal que ya no está en cola es 409 con el estado que tiene', async () => {
      channels.requireById.mockResolvedValueOnce(canal({ status: 'OPEN' }) as never);

      const fallo = await service.claimChannel({ tenantId: 't1', actor: AGENTE, channelId: '5' }).catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ConflictException);
      expect((fallo as ConflictException).getResponse()).toMatchObject({ code: 'SUPPORT_CHANNEL_ALREADY_CLAIMED', status: 'OPEN' });
    });

    it('la capacidad se reserva ANTES de tocar el canal', async () => {
      await service.claimChannel({ tenantId: 't1', actor: AGENTE, channelId: '5' });

      expect(disponibilidad.reserveAvailableAgent).toHaveBeenCalledWith({ tenantId: 't1', queueId: '11', requiredSkills: [] });
    });

    it('sin capacidad libre no se asigna, y el canal sigue en cola para otro', async () => {
      disponibilidad.reserveAvailableAgent.mockResolvedValueOnce(null as never);

      await expect(service.claimChannel({ tenantId: 't1', actor: AGENTE, channelId: '5' })).rejects.toBeInstanceOf(ConflictException);
      expect(channels.update).not.toHaveBeenCalled();
    });

    it('si la reserva cayó en OTRO agente se le devuelve su hueco en vez de quedárselo', async () => {
      disponibilidad.reserveAvailableAgent.mockResolvedValueOnce({ agentProfileId: 'ag-otro' } as never);

      await expect(service.claimChannel({ tenantId: 't1', actor: AGENTE, channelId: '5' })).rejects.toBeInstanceOf(ConflictException);
      expect(disponibilidad.releaseAgentSlot).toHaveBeenCalledWith('t1', 'ag-otro');
    });

    it('tomarlo lo abre, sube `claimVersion` y registra al agente como participante', async () => {
      channels.requireById
        .mockResolvedValueOnce(canal() as never)
        .mockResolvedValueOnce(canal({ claimVersion: 3 }) as never)
        .mockResolvedValueOnce(canal({ status: 'OPEN', claimVersion: 4 }) as never);

      const dto = await service.claimChannel({ tenantId: 't1', actor: AGENTE, channelId: '5' });

      expect(channels.update).toHaveBeenCalledWith(
        't1',
        '5',
        expect.objectContaining({ status: 'OPEN', assignedAgentProfileId: 'ag-1', claimVersion: 4 }),
        expect.anything(),
      );
      expect(channels.addParticipant).toHaveBeenCalledWith(
        expect.objectContaining({ roleInChannel: 'AGENT', joinReason: 'agent_claim' }),
        expect.anything(),
      );
      expect(dto.status).toBe('OPEN');
    });

    it('si otro lo tomó entre la reserva y el bloqueo, se contesta 409 y no se pisa su asignación', async () => {
      channels.requireById.mockResolvedValueOnce(canal() as never).mockResolvedValueOnce(canal({ status: 'OPEN' }) as never);

      await expect(service.claimChannel({ tenantId: 't1', actor: AGENTE, channelId: '5' })).rejects.toBeInstanceOf(ConflictException);
      expect(channels.update).not.toHaveBeenCalled();
    });
  });

  describe('cerrar el canal', () => {
    it('cerrar dos veces es inofensivo: se devuelve el canal como está', async () => {
      channels.requireById.mockResolvedValueOnce(canal({ status: 'CLOSED' }) as never);

      await service.closeChannel({ tenantId: 't1', actor: CLIENTE, channelId: '5', dto: { reason: 'resuelto' } as never });

      expect(channels.update).not.toHaveBeenCalled();
      expect(audit.publish).not.toHaveBeenCalled();
    });

    it('cerrar el canal NO cierra el caso: sólo escribe quién, cuándo y por qué', async () => {
      await service.closeChannel({ tenantId: 't1', actor: CLIENTE, channelId: '5', dto: { reason: 'resuelto' } as never });

      expect(channels.update).toHaveBeenCalledWith(
        't1',
        '5',
        expect.objectContaining({ status: 'CLOSED', closedByActorId: '42', closeReason: 'resuelto' }),
        expect.anything(),
      );
      expect(cases.appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CHANNEL_CLOSED' }), expect.anything());
    });

    it('saca a los participantes VIVOS y no vuelve a sacar a los que ya salieron', async () => {
      channels.listParticipants.mockResolvedValueOnce([
        { actorType: 'CUSTOMER', actorId: '42', leftAt: null },
        { actorType: 'AGENT', actorId: '7', leftAt: new Date('2026-09-01T10:00:00Z') },
      ] as never);

      await service.closeChannel({ tenantId: 't1', actor: CLIENTE, channelId: '5', dto: { reason: 'resuelto' } as never });

      expect(channels.removeParticipant).toHaveBeenCalledTimes(1);
      expect(channels.removeParticipant).toHaveBeenCalledWith('5', 'CUSTOMER', '42', 'resuelto', expect.anything());
    });

    it('devuelve el hueco del agente para que la cola vuelva a repartir', async () => {
      channels.requireById.mockResolvedValue(canal({ assignedAgentProfileId: 'ag-1' }) as never);

      await service.closeChannel({ tenantId: 't1', actor: AGENTE, channelId: '5', dto: { reason: 'resuelto' } as never });

      expect(disponibilidad.releaseAgentSlot).toHaveBeenCalledWith('t1', 'ag-1');
    });

    it('un canal sin agente no libera hueco de nadie', async () => {
      await service.closeChannel({ tenantId: 't1', actor: CLIENTE, channelId: '5', dto: { reason: 'resuelto' } as never });

      expect(disponibilidad.releaseAgentSlot).not.toHaveBeenCalled();
    });

    it('un canal sin caso detrás no escribe evento de expediente', async () => {
      channels.requireById.mockResolvedValue(canal({ caseId: null }) as never);

      await service.closeChannel({ tenantId: 't1', actor: CLIENTE, channelId: '5', dto: { reason: 'resuelto' } as never });

      expect(cases.appendEvent).not.toHaveBeenCalled();
    });
  });
});
