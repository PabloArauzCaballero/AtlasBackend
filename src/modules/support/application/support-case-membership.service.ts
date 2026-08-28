/**
 * @file Servicio de aplicación: quién entra y quién sale de los canales de un caso.
 * @business El agente responsable puede leer la conversación; el que ya no lo es, deja de poder.
 * @system la autorización de la transcripción es la participación viva, no el rol ni la asignación.
 */
import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';

@Injectable()
export class SupportCaseMembershipService {
  constructor(
    private readonly channels: SupportChannelRepository,
    private readonly agents: SupportAgentRepository,
  ) {}

  /**
   * El agente responsable ENTRA en los canales del caso.
   *
   * Sin esto, quien tiene el caso asignado no puede leer la conversación: la autorización de la
   * transcripción es la participación viva, no el rol ni la asignación. Se descubrió probándolo de
   * punta a punta —el agente tomaba el caso y recibía 403 al abrir el chat—, y es exactamente la
   * clase de hueco que un type-check no ve.
   *
   * De paso, un canal que estaba esperando pasa a `OPEN`: ya hay alguien del otro lado.
   */
  async joinCaseChannels(
    input: { tenantId: string; caseId: string; agentProfileId: string; agentInternalUserId: string; reason: string },
    transaction: Transaction,
  ): Promise<void> {
    const channels = await this.channels.listChannelsForCase(input.caseId);
    for (const channel of channels) {
      if (['CLOSED', 'ABANDONED'].includes(channel.status)) continue;

      const already = await this.channels.findLiveParticipant(String(channel.id), 'AGENT', input.agentInternalUserId, { transaction });
      if (!already) {
        await this.channels.addParticipant(
          {
            tenantId: input.tenantId,
            channelId: String(channel.id),
            actorType: 'AGENT',
            actorId: input.agentInternalUserId,
            agentProfileId: input.agentProfileId,
            roleInChannel: 'AGENT',
            joinedAt: new Date(),
            joinReason: input.reason,
          },
          { transaction },
        );
      }

      await this.channels.update(
        input.tenantId,
        String(channel.id),
        {
          assignedAgentProfileId: input.agentProfileId,
          status: ['REQUESTED', 'QUEUED'].includes(channel.status) ? 'OPEN' : channel.status,
          openedAt: channel.openedAt ?? new Date(),
        },
        { transaction },
      );
    }
  }

  /**
   * El agente anterior SALE de los canales al transferir.
   *
   * Dejarlo dentro convertiría cada transferencia en un permiso de lectura permanente sobre la
   * conversación de un cliente que ya no atiende. La fila del participante no se borra: queda con
   * su `left_at`, que es la prueba de cuándo dejó de poder leerla.
   */
  async leaveCaseChannels(
    tenantId: string,
    caseId: string,
    previousAgentProfileId: string | null,
    reason: string,
    transaction: Transaction,
  ): Promise<void> {
    if (!previousAgentProfileId) return;
    const previous = await this.agents.findById(tenantId, String(previousAgentProfileId), { transaction });
    if (!previous) return;

    for (const channel of await this.channels.listChannelsForCase(caseId)) {
      await this.channels.removeParticipant(String(channel.id), 'AGENT', String(previous.internalUserId), `transfer: ${reason}`, {
        transaction,
      });
    }
  }
}
