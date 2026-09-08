/**
 * @file Servicio de aplicación: la mesa del agente — su presencia y la cola que puede tomar.
 * @business Declararse disponible y ver qué conversaciones están esperando a alguien.
 * @system separado del ciclo de vida del canal: aquí no se abre ni se cierra nada, sólo se mira y se declara.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import {
  SUPPORT_CASE_TYPES,
  SUPPORT_IMPACTS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_RESOLUTION_CODE_LABELS,
  SUPPORT_RESOLUTION_CODES,
  SUPPORT_ROOT_CAUSE_CODE_LABELS,
  SUPPORT_ROOT_CAUSE_CODES,
  SUPPORT_URGENCIES,
} from '../support.constants.js';
import type { CreateAgentProfileDto } from '../support-case.schemas.js';
import { toChannelDto, toInternalCategoryTreeDto, toQueueDto } from '../support.mapper.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';

@Injectable()
export class SupportDeskService {
  constructor(
    private readonly channels: SupportChannelRepository,
    private readonly agents: SupportAgentRepository,
    private readonly actors: SupportActorService,
    private readonly catalog: SupportCatalogRepository,
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

  /**
   * El árbol de motivos con el que el agente reclasifica.
   *
   * Se pide el de la audiencia interna —que las incluye todas— porque el agente triaja casos de
   * consumidores y de comercios por igual. Que la lista salga vacía no es un fallo de esta ruta: el
   * catálogo no vive en el repositorio, lo siembra la rama de semillas, y una base recién migrada
   * responde `{ categories: [] }` aquí y `SUPPORT_CATEGORY_NOT_FOUND` al abrir cualquier caso.
   */
  async listInternalCategories(input: { tenantId: string; actor: SupportActor }) {
    this.actors.assertIsAgent(input.actor);
    const categories = await this.catalog.listCategories(input.tenantId, this.actors.caseCategoryAudiences(input.actor));
    return { categories: toInternalCategoryTreeDto(categories) };
  }

  /** Las colas activas: destino posible de un triage, una transferencia o un escalado. */
  async listQueues(input: { tenantId: string; actor: SupportActor }) {
    this.actors.assertIsAgent(input.actor);
    const queues = await this.catalog.listQueues(input.tenantId);
    return { queues: queues.map(toQueueDto) };
  }

  /**
   * Los códigos con los que se cierra un caso, con su descripción.
   *
   * No toca la base: son constantes del módulo. Viajan por HTTP para que la consola no los copie —
   * un catálogo duplicado en el frontend se desincroniza en la primera revisión de la taxonomía, y
   * como la columna es VARCHAR sin CHECK hasta la migración del 2026-09-05, el desajuste no se
   * habría notado hasta que alguien contara.
   */
  supportCodes() {
    return {
      resolutionCodes: SUPPORT_RESOLUTION_CODES.map((code) => ({ code, label: SUPPORT_RESOLUTION_CODE_LABELS[code] })),
      rootCauseCodes: SUPPORT_ROOT_CAUSE_CODES.map((code) => ({ code, label: SUPPORT_ROOT_CAUSE_CODE_LABELS[code] })),
      priorities: SUPPORT_PRIORITIES.map((code) => ({ code, label: SUPPORT_PRIORITY_LABELS[code] })),
      caseTypes: [...SUPPORT_CASE_TYPES],
      impacts: [...SUPPORT_IMPACTS],
      urgencies: [...SUPPORT_URGENCIES],
    };
  }

  /** Quién está habilitado para atender, con su nivel, su cola y su ocupación actual. */
  async listAgents(input: { tenantId: string }) {
    return { agents: await this.agents.listProfiles(input.tenantId) };
  }

  /**
   * Habilitar a una persona interna como agente.
   *
   * Reactiva en vez de insertar cuando ya hubo un perfil dado de baja: `uq_support_agent_user` es por
   * (tenant, persona) y no mira `is_active`, así que un alta repetida chocaría con un error de base
   * que no explica nada. Reactivar además conserva el mismo `agent_profile_id` en las asignaciones y
   * los eventos ya escritos, que es lo que permite auditar después quién atendió qué.
   */
  async createAgent(input: { tenantId: string; body: CreateAgentProfileDto }) {
    const exists = await this.agents.internalUserExists(input.tenantId, input.body.internalUserId);
    if (!exists) {
      throw new NotFoundException({ code: 'SUPPORT_INTERNAL_USER_NOT_FOUND', internalUserId: input.body.internalUserId });
    }

    const queue = input.body.queueCode ? await this.catalog.requireQueueByCode(input.tenantId, input.body.queueCode) : null;
    const queueId = queue ? String(queue.id) : null;
    const previous = await this.agents.findAnyByInternalUser(input.tenantId, input.body.internalUserId);

    if (previous && previous.isActive && !previous.deleted) {
      throw new ConflictException({
        code: 'SUPPORT_AGENT_PROFILE_EXISTS',
        message: 'Esta persona ya tiene perfil de agente activo.',
        agentProfileId: String(previous.id),
      });
    }

    if (previous) {
      await this.agents.reactivateProfile(input.tenantId, String(previous.id), {
        supportLevel: input.body.supportLevel,
        defaultQueueId: queueId,
        maxConcurrentChannels: input.body.maxConcurrentChannels,
      });
      return { agentProfileId: String(previous.id), reactivated: true };
    }

    const created = await this.agents.createProfile({
      tenantId: input.tenantId,
      internalUserId: input.body.internalUserId,
      supportLevel: input.body.supportLevel,
      defaultQueueId: queueId,
      maxConcurrentChannels: input.body.maxConcurrentChannels,
      timezone: input.body.timezone,
      languageCodes: input.body.languageCodes,
    });
    return { agentProfileId: String(created.id), reactivated: false };
  }

  /** Quitar a alguien de la mesa. No borra su historia: apaga el perfil. */
  async deactivateAgent(input: { tenantId: string; agentProfileId: string }) {
    const profile = await this.agents.findById(input.tenantId, input.agentProfileId);
    if (!profile) throw new NotFoundException({ code: 'SUPPORT_AGENT_PROFILE_NOT_FOUND', agentProfileId: input.agentProfileId });
    await this.agents.deactivateProfile(input.tenantId, input.agentProfileId);
    return { agentProfileId: input.agentProfileId, isActive: false };
  }
}
