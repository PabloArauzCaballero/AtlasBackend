/**
 * @file Servicio de aplicación: la mesa del agente — su presencia y la cola que puede tomar.
 * @business Declararse disponible y ver qué conversaciones están esperando a alguien.
 * @system separado del ciclo de vida del canal: aquí no se abre ni se cierra nada, sólo se mira y se declara.
 */
import { Injectable } from '@nestjs/common';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import { toChannelDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';

@Injectable()
export class SupportDeskService {
  constructor(
    private readonly channels: SupportChannelRepository,
    private readonly agents: SupportAgentRepository,
    private readonly actors: SupportActorService,
  ) {}

  /** La cola de espera del equipo: conversaciones sin agente, en orden de llegada. */
  async listQueuedChannels(input: { tenantId: string; actor: SupportActor; queueId?: string | null }) {
    this.actors.assertIsAgent(input.actor);
    const rows = await this.channels.listQueuedChannels(input.tenantId, input.queueId ?? null);
    return { channels: rows.map(toChannelDto) };
  }

  /** Presencia del agente. Es efímera: si Redis o el proceso caen, el peor caso es no recibir chats. */
  async setPresence(input: { tenantId: string; actor: SupportActor; presenceState: string }) {
    const agentProfileId = this.actors.assertIsAgent(input.actor);
    await this.agents.setPresence(input.tenantId, agentProfileId, input.presenceState);
    return { agentProfileId, presenceState: input.presenceState };
  }
}
