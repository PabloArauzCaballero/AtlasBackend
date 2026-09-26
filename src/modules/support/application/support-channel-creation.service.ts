/**
 * @file La escritura del canal recién pedido: el caso, el canal y su primera membresía.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { generateChannelCode } from '../domain/case-number.util.js';

import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import type { OpenChannelDto } from '../support-case.schemas.js';

import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseService } from './support-case.service.js';
import { SupportMessageService } from './support-message.service.js';

/**
 * Sale de `SupportChannelService` porque es lo único de ese archivo que ESCRIBE la apertura
 * completa en una transacción; el resto —pedir, tomar y cerrar— son operaciones cortas sobre un
 * canal que ya existe. Juntas pasaban del límite de `check:file-size`.
 */
@Injectable()
export class SupportChannelCreationService {
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

  /** Escribe el canal y sus participantes en una sola transacción, con o sin agente reservado. */
  persistRequestedChannel(context: {
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
            categoryCode: input.dto.categoryCode,
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
}
