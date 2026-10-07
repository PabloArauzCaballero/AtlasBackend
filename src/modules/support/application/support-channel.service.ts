/**
 * @file Servicio de aplicación: abrir, atender y cerrar el canal de atención.
 * @business Conecta a quien pide ayuda con un agente elegible disponible, o le deja dejar el mensaje.
 * @system reserva atómica del agente, participantes registrados y cierre que no cierra el caso.
 */
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { SupportChannelModel } from '../../../database/models/index.js';

import { SUPPORT_QUEUE_CODES } from '../support.constants.js';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import type { CloseChannelDto, OpenChannelDto } from '../support-case.schemas.js';
import { toChannelDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseService } from './support-case.service.js';
import { SupportMessageService } from './support-message.service.js';
import { SUPPORT_NEVER_ASKS_WARNING } from '../domain/message-dlp.js';
import { SupportChannelCreationService } from './support-channel-creation.service.js';

import { SupportAgentAvailabilityRepository } from '../support-agent-availability.repository.js';
@Injectable()
export class SupportChannelService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly channels: SupportChannelRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly agents: SupportAgentRepository,
    private readonly cases: SupportCaseRepository,
    private readonly messages: SupportMessageService,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
    private readonly caseService: SupportCaseService,
    private readonly apertura: SupportChannelCreationService,
    private readonly disponibilidad: SupportAgentAvailabilityRepository,
  ) {}

  /**
   * «Hablar con soporte»: entra a la cola y se le asigna un agente elegible.
   *
   * ## Por qué no se le muestra una lista de agentes
   *
   * Porque elegir persona no es elegir ayuda: quien pide soporte no sabe quién sabe de QR o de
   * conciliación, y una lista produce que tres personas escriban al mismo agente mientras otros
   * cuatro están libres. El sistema reserva por competencia y carga.
   *
   * ## Qué pasa si no hay nadie
   *
   * El canal se crea igual, en estado `QUEUED`, y la respuesta dice cuántos agentes hay y que puede
   * dejar su mensaje. Bloquear con «no hay agentes, intente más tarde» es lo que empuja a la gente
   * a escribir por redes sociales, donde nada de esto queda registrado.
   *
   * ## Por qué se reutiliza el canal vivo
   *
   * Abrir soporte desde dos pantallas no debe crear dos conversaciones: el agente vería a la misma
   * persona duplicada. Se devuelve el canal que ya estaba, sin error, porque el usuario no hizo
   * nada mal.
   */
  async requestChannel(input: { tenantId: string; actor: SupportActor; dto: OpenChannelDto }) {
    if (input.dto.partnerProfileId) {
      await this.actors.assertOwnsPartnerProfile(input.actor, input.dto.partnerProfileId, input.tenantId);
    }
    const existing = await this.findLiveChannel(input);
    if (existing) return { ...toChannelDto(existing), reused: true, agentsAvailable: null as number | null };
    await this.assertMayOpenFor(input);

    const defaultQueueCode = input.actor.actorType === 'PARTNER_USER' ? SUPPORT_QUEUE_CODES.PARTNER_L1 : SUPPORT_QUEUE_CODES.CONSUMER_L1;
    // La categoría y la cola por defecto no dependen una de otra: se piden a la vez. Sólo si la categoría
    // trae su propia cola se descarta la de por defecto (una ida a la base de más, no una espera de más).
    const [category, defaultQueue] = await Promise.all([
      input.dto.categoryCode ? this.catalog.findCategoryByCode(input.tenantId, input.dto.categoryCode) : Promise.resolve(null),
      this.catalog.findQueueByCode(input.tenantId, defaultQueueCode),
    ]);
    const queue = category?.defaultQueueId
      ? await this.catalog.findQueueById(input.tenantId, String(category.defaultQueueId))
      : defaultQueue;

    const reserved = await this.disponibilidad.reserveAvailableAgent({
      tenantId: input.tenantId,
      queueId: queue ? String(queue.id) : null,
      requiredSkills: (queue?.skillsRequiredJson ?? []) as string[],
    });

    // La reserva ya subió el contador del agente en su propia sentencia: si la apertura falla —un
    // `caseId` que no existe basta—, el hueco se devuelve o el agente acaba «lleno» sin conversaciones.
    const channel = await this.apertura.persistRequestedChannel({ input, queue, reserved }).catch(async (error: unknown) => {
      if (reserved) await this.disponibilidad.releaseAgentSlot(input.tenantId, reserved.agentProfileId);
      throw error;
    });

    /*
      Tres cosas que no se esperan entre sí: el aviso de seguridad, la auditoría y el conteo de agentes.
      Iban una detrás de otra, y cada una es una ida a la base que la persona pagaba mirando un círculo.
      El aviso lo manda el SISTEMA, no el agente: así aparece siempre, incluso a las once de la noche
      cuando quien atiende está cansado y no se acuerda de escribirlo.
    */
    const [, , agentsAvailable] = await Promise.all([
      this.messages.append({
        tenantId: input.tenantId,
        channelId: String(channel.id),
        actor: { ...input.actor, actorType: 'SYSTEM', actorId: 'system' },
        clientMessageId: `warning-${channel.id}`,
        body: SUPPORT_NEVER_ASKS_WARNING,
        messageType: 'SECURITY_WARNING',
        visibility: 'SYSTEM',
      }),
      this.audit.publish({
        tenantId: input.tenantId,
        eventCode: 'support.channel.opened',
        aggregateType: 'support_channel',
        aggregateId: String(channel.id),
        payload: { queueId: channel.queueId, assigned: Boolean(reserved) },
        idempotencyKey: `support-channel-opened-${channel.id}`,
      }),
      reserved ? Promise.resolve(null) : this.disponibilidad.countAvailable(input.tenantId, queue ? String(queue.id) : null),
    ]);
    return { ...toChannelDto(channel), reused: false, agentsAvailable };
  }

  /** El canal vivo de quien pide: el del cliente, o el del usuario del comercio en ese comercio. */
  private async findLiveChannel(input: { tenantId: string; actor: SupportActor; dto: OpenChannelDto }) {
    if (input.actor.actorType === 'CUSTOMER' && input.actor.customerId) {
      return this.channels.findLiveChannelForCustomer(input.tenantId, input.actor.customerId);
    }
    if (input.actor.actorType === 'PARTNER_USER' && input.dto.partnerProfileId) {
      return this.channels.findLiveChannelForPartnerUser(input.tenantId, input.dto.partnerProfileId, input.actor.actorId);
    }
    return null;
  }

  /**
   * El `caseId` del cuerpo es una afirmación de quien llama, no un hecho: se comprueba que el caso
   * sea suyo (y del mismo comercio) antes de colgarle una conversación. Sin esto, lo que escribía un
   * cliente aparecía dentro del expediente de otro.
   */
  private async assertMayOpenFor(input: { tenantId: string; actor: SupportActor; dto: OpenChannelDto }): Promise<void> {
    if (!input.dto.caseId) return;
    const supportCase = await this.cases.requireById(input.tenantId, input.dto.caseId);
    await this.actors.assertCanViewCase(input.actor, supportCase, input.tenantId);
    const casePartner = supportCase.subjectPartnerProfileId ? String(supportCase.subjectPartnerProfileId) : null;
    if (input.actor.actorType === 'PARTNER_USER' && casePartner !== (input.dto.partnerProfileId ?? null)) {
      throw new ForbiddenException({ code: 'SUPPORT_CASE_FORBIDDEN' });
    }
  }

  /**
   * Quién puede cerrar: quien está dentro, el titular de la conversación, el agente asignado o un
   * supervisor. Sin esta comprobación cualquier usuario autenticado cerraba el chat de cualquiera
   * recorriendo ids, y dejaba su firma en la historia —que no se corrige— de un expediente ajeno.
   */
  private async assertMayClose(tenantId: string, channel: SupportChannelModel, actor: SupportActor): Promise<void> {
    if (actor.isSupervisor) return;
    if (actor.agentProfileId && String(channel.assignedAgentProfileId ?? '') === actor.agentProfileId) return;
    if (actor.actorType === 'CUSTOMER' && actor.customerId && String(channel.subjectCustomerId ?? '') === actor.customerId) return;
    // Repetir el cierre es inofensivo para quien lo cerró, aunque ya no figure dentro.
    if (channel.status === 'CLOSED' && channel.closedByActorId === actor.actorId) return;
    await this.messages.assertParticipates(tenantId, String(channel.id), actor);
  }

  /**
   * Un agente toma un canal encolado.
   *
   * La reserva de capacidad ocurre ANTES de tocar el canal: si el agente ya está al límite, no se
   * le asigna y el canal sigue en cola para otro. Después se BLOQUEA la fila del canal y se vuelve a
   * mirar que siga encolado, así que dos agentes pulsando a la vez producen un ganador y un 409 —no
   * dos agentes escribiéndole a la misma persona.
   */
  async claimChannel(input: { tenantId: string; actor: SupportActor; channelId: string }) {
    const agentProfileId = this.actors.assertIsAgent(input.actor);
    const channel = await this.channels.requireById(input.tenantId, input.channelId);
    if (!['REQUESTED', 'QUEUED'].includes(channel.status)) {
      throw new ConflictException({ code: 'SUPPORT_CHANNEL_ALREADY_CLAIMED', status: channel.status });
    }

    if (!(await this.disponibilidad.reserveSlotOf(input.tenantId, agentProfileId))) {
      throw new ConflictException({ code: 'SUPPORT_AGENT_AT_CAPACITY', message: 'No tienes capacidad libre para otra conversación.' });
    }

    // Si otro lo tomó entre la reserva y el bloqueo, el hueco se devuelve: si no, el contador sube
    // para siempre y el agente acaba «lleno» sin ninguna conversación.
    const updated = await this.sequelize
      .transaction(async (transaction) => {
        const locked = await this.channels.lockById(input.tenantId, input.channelId, transaction);
        if (!['REQUESTED', 'QUEUED'].includes(locked.status)) {
          throw new ConflictException({ code: 'SUPPORT_CHANNEL_ALREADY_CLAIMED', status: locked.status });
        }
        await this.channels.update(
          input.tenantId,
          input.channelId,
          {
            status: 'OPEN',
            assignedAgentProfileId: agentProfileId,
            openedAt: new Date(),
            claimVersion: locked.claimVersion + 1,
          },
          { transaction },
        );
        await this.channels.addParticipant(
          {
            tenantId: input.tenantId,
            channelId: input.channelId,
            actorType: 'AGENT',
            actorId: input.actor.actorId,
            agentProfileId,
            roleInChannel: 'AGENT',
            joinedAt: new Date(),
            joinReason: 'agent_claim',
          },
          { transaction },
        );
        return this.channels.requireById(input.tenantId, input.channelId, { transaction });
      })
      .catch(async (error: unknown) => {
        await this.disponibilidad.releaseAgentSlot(input.tenantId, agentProfileId);
        throw error;
      });

    return toChannelDto(updated);
  }

  /**
   * Cerrar el canal NO cierra el caso.
   *
   * Quien cierra el chat puede haberse quedado sin batería. Aquí sólo se escribe quién cerró, cuándo
   * y por qué; el expediente sigue su ciclo y alguien tendrá que resolverlo. Además se devuelve el
   * hueco del agente, para que la cola vuelva a repartir.
   */
  async closeChannel(input: { tenantId: string; actor: SupportActor; channelId: string; dto: CloseChannelDto }) {
    const channel = await this.channels.requireById(input.tenantId, input.channelId);
    await this.assertMayClose(input.tenantId, channel, input.actor);
    if (channel.status === 'CLOSED') return toChannelDto(channel);

    const closed = await this.sequelize.transaction(async (transaction) => {
      await this.channels.update(
        input.tenantId,
        input.channelId,
        { status: 'CLOSED', closedAt: new Date(), closedByActorId: input.actor.actorId, closeReason: input.dto.reason },
        { transaction },
      );

      const participants = await this.channels.listParticipants(input.channelId, { transaction });
      for (const participant of participants) {
        if (participant.leftAt) continue;
        await this.channels.removeParticipant(input.channelId, participant.actorType, participant.actorId, input.dto.reason, {
          transaction,
        });
      }

      if (channel.caseId) {
        await this.cases.appendEvent(
          {
            tenantId: input.tenantId,
            caseId: String(channel.caseId),
            eventType: 'CHANNEL_CLOSED',
            actorType: input.actor.actorType,
            actorId: input.actor.actorId,
            payload: { channelId: input.channelId, reason: input.dto.reason, note: input.dto.note ?? null },
          },
          transaction,
        );
      }

      return this.channels.requireById(input.tenantId, input.channelId, { transaction });
    });

    if (channel.assignedAgentProfileId) {
      await this.disponibilidad.releaseAgentSlot(input.tenantId, String(channel.assignedAgentProfileId));
    }
    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: 'support.channel.closed',
      aggregateType: 'support_channel',
      aggregateId: input.channelId,
      payload: { reason: input.dto.reason, caseId: channel.caseId ? String(channel.caseId) : null },
      idempotencyKey: `support-channel-closed-${input.channelId}`,
    });

    return toChannelDto(closed);
  }
}
