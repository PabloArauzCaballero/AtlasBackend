/**
 * @file Servicio de aplicación: abrir, atender y cerrar el canal de atención.
 * @business Conecta a quien pide ayuda con un agente elegible disponible, o le deja dejar el mensaje.
 * @system reserva atómica del agente, participantes registrados y cierre que no cierra el caso.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { generateChannelCode } from '../domain/case-number.util.js';
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
    const existing =
      input.actor.actorType === 'CUSTOMER' && input.actor.customerId
        ? await this.channels.findLiveChannelForCustomer(input.tenantId, input.actor.customerId)
        : input.actor.actorType === 'PARTNER_USER' && input.dto.partnerProfileId
          ? await this.channels.findLiveChannelForPartnerUser(input.tenantId, input.dto.partnerProfileId, input.actor.actorId)
          : null;
    if (existing) return { ...toChannelDto(existing), reused: true, agentsAvailable: null as number | null };

    const category = input.dto.categoryCode ? await this.catalog.findCategoryByCode(input.tenantId, input.dto.categoryCode) : null;
    const defaultQueueCode = input.actor.actorType === 'PARTNER_USER' ? SUPPORT_QUEUE_CODES.PARTNER_L1 : SUPPORT_QUEUE_CODES.CONSUMER_L1;
    const queue = category?.defaultQueueId
      ? await this.catalog.findQueueById(input.tenantId, String(category.defaultQueueId))
      : await this.catalog.findQueueByCode(input.tenantId, defaultQueueCode);

    const reserved = await this.agents.reserveAvailableAgent({
      tenantId: input.tenantId,
      queueId: queue ? String(queue.id) : null,
      requiredSkills: (queue?.skillsRequiredJson ?? []) as string[],
    });

    const channel = await this.persistRequestedChannel({ input, queue, reserved });

    // El aviso de seguridad lo manda el SISTEMA, no el agente: así aparece siempre, incluso a las
    // once de la noche cuando quien atiende está cansado y no se acuerda de escribirlo.
    await this.messages.append({
      tenantId: input.tenantId,
      channelId: String(channel.id),
      actor: { ...input.actor, actorType: 'SYSTEM', actorId: 'system' },
      clientMessageId: `warning-${channel.id}`,
      body: SUPPORT_NEVER_ASKS_WARNING,
      messageType: 'SECURITY_WARNING',
      visibility: 'SYSTEM',
    });

    await this.audit.publish({
      tenantId: input.tenantId,
      eventCode: 'support.channel.opened',
      aggregateType: 'support_channel',
      aggregateId: String(channel.id),
      payload: { queueId: channel.queueId, assigned: Boolean(reserved) },
      idempotencyKey: `support-channel-opened-${channel.id}`,
    });

    const agentsAvailable = reserved ? null : await this.agents.countAvailable(input.tenantId, queue ? String(queue.id) : null);
    return { ...toChannelDto(channel), reused: false, agentsAvailable };
  }

  /** Escribe el canal y sus participantes en una sola transacción, con o sin agente reservado. */
  private persistRequestedChannel(context: {
    input: { tenantId: string; actor: SupportActor; dto: OpenChannelDto };
    queue: { id: string } | null;
    reserved: { agentProfileId: string; internalUserId: string } | null;
  }) {
    const { input, queue, reserved } = context;
    return this.sequelize.transaction(async (transaction) => {
      /*
       * Ninguna conversación sin expediente.
       *
       * Si quien abre no trae `caseId` —y hoy no lo trae NADIE: la app llama `openChannel({})` y el
       * portal manda sólo el comercio— el servidor crea el caso mínimo antes de crear el canal. Va
       * dentro de la misma transacción para que no exista jamás el estado intermedio de un canal
       * apuntando a un caso que no llegó a escribirse.
       *
       * Devuelve null sólo si falta la categoría de red de seguridad; en ese caso la conversación se
       * abre igual, sin caso, porque no dejar hablar con soporte sería peor que el dato que falta.
       */
      const unclassified = input.dto.caseId
        ? null
        : await this.caseService.createUnclassifiedCase({
            tenantId: input.tenantId,
            actor: input.actor,
            partnerProfileId: input.dto.partnerProfileId ?? null,
            transaction,
          });

      const created = await this.channels.create(
        {
          tenantId: input.tenantId,
          channelCode: generateChannelCode(),
          caseId: input.dto.caseId ?? unclassified?.caseId ?? null,
          channelType: 'CHAT',
          subjectContextType: input.actor.actorType === 'PARTNER_USER' ? 'PARTNER_USER' : 'CONSUMER',
          subjectCustomerId: input.actor.customerId,
          subjectPartnerProfileId: input.dto.partnerProfileId ?? null,
          status: reserved ? 'OPEN' : 'QUEUED',
          queueId: queue ? String(queue.id) : null,
          assignedAgentProfileId: reserved?.agentProfileId ?? null,
          requestedAt: new Date(),
          openedAt: reserved ? new Date() : null,
          lastActivityAt: new Date(),
          lastMessageSequence: '0',
          claimVersion: reserved ? 1 : 0,
          locale: input.dto.locale,
          deleted: false,
        },
        { transaction },
      );

      await this.channels.addParticipant(
        {
          tenantId: input.tenantId,
          channelId: String(created.id),
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          roleInChannel: 'REQUESTER',
          joinedAt: new Date(),
          joinReason: 'channel_requested',
        },
        { transaction },
      );

      if (reserved) {
        await this.channels.addParticipant(
          {
            tenantId: input.tenantId,
            channelId: String(created.id),
            actorType: 'AGENT',
            actorId: reserved.internalUserId,
            agentProfileId: reserved.agentProfileId,
            roleInChannel: 'AGENT',
            joinedAt: new Date(),
            joinReason: 'auto_routing',
          },
          { transaction },
        );
      }

      return created;
    });
  }

  /**
   * Un agente toma un canal encolado.
   *
   * La reserva de capacidad ocurre ANTES de tocar el canal: si el agente ya está al límite, no se
   * le asigna y el canal sigue en cola para otro. Después se marca el canal con `claimVersion + 1`
   * condicionado a que siga encolado, así que dos agentes pulsando a la vez producen un ganador y
   * un 409 —no dos agentes escribiéndole a la misma persona.
   */
  async claimChannel(input: { tenantId: string; actor: SupportActor; channelId: string }) {
    const agentProfileId = this.actors.assertIsAgent(input.actor);
    const channel = await this.channels.requireById(input.tenantId, input.channelId);
    if (!['REQUESTED', 'QUEUED'].includes(channel.status)) {
      throw new ConflictException({ code: 'SUPPORT_CHANNEL_ALREADY_CLAIMED', status: channel.status });
    }

    const reserved = await this.agents.reserveAvailableAgent({
      tenantId: input.tenantId,
      queueId: channel.queueId ? String(channel.queueId) : null,
      requiredSkills: [],
    });
    if (!reserved || reserved.agentProfileId !== agentProfileId) {
      // Se reservó a otro (o a nadie): se devuelve el hueco y se pide reintentar sin adivinar.
      if (reserved) await this.agents.releaseAgentSlot(input.tenantId, reserved.agentProfileId);
      throw new ConflictException({ code: 'SUPPORT_AGENT_AT_CAPACITY', message: 'No tienes capacidad libre para otra conversación.' });
    }

    const updated = await this.sequelize.transaction(async (transaction) => {
      const locked = await this.channels.requireById(input.tenantId, input.channelId, { transaction });
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
        await this.channels.removeParticipant(
          input.channelId,
          participant.actorType,
          participant.actorId,
          input.dto.reason,
          { transaction },
        );
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
      await this.agents.releaseAgentSlot(input.tenantId, String(channel.assignedAgentProfileId));
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
