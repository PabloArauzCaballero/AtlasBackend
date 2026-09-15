/**
 * @file A qué cola y con qué clasificación acaba un caso, y el resumen de traspaso.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportAgentRepository } from '../support-agent.repository.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import type { TriageCaseDto } from '../support-case.schemas.js';
import { derivePriority, mostUrgent } from '../domain/priority-policy.js';
import type { SupportImpact, SupportPriority, SupportUrgency } from '../support.constants.js';

import type { SupportActor } from './support-actor.service.js';
import { SupportActorService } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseMembershipService } from './support-case-membership.service.js';
import { SupportCaseTransitionService } from './support-case-transition.service.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import { SupportMessageService } from './support-message.service.js';

/**
 * Sale de `SupportCaseWorkflowService` porque son las tres piezas que ese servicio usa para
 * DECIDIR el destino, frente a las tres que ejecutan el movimiento (triar, asignar, transferir).
 * Juntas pasaban del límite de `check:file-size`.
 */
@Injectable()
export class SupportCaseRoutingService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly catalog: SupportCatalogRepository,
    private readonly agents: SupportAgentRepository,
    private readonly channels: SupportChannelRepository,
    private readonly messages: SupportMessageService,
    private readonly membership: SupportCaseMembershipService,
    private readonly transitions: SupportCaseTransitionService,
    private readonly actors: SupportActorService,
    private readonly audit: SupportAuditService,
  ) {}

  /**
   * Resuelve la clasificación pedida contra el catálogo, sin escribir nada.
   *
   * La prioridad manual no puede REBAJAR el piso que la matriz calcula para seguridad y fraude: si
   * pudiera, bastaría reclasificar un incidente para que dejara de correr contra su reloj. Por eso
   * se combina con `mostUrgent` en vez de aceptarse tal cual.
   */
  /**
   * El resumen de traspaso, como nota interna dentro de la conversación.
   *
   * Es lo que evita que el cliente tenga que contar otra vez toda su historia al siguiente agente
   * —la experiencia que la gente recuerda como «me pasaron de un lado a otro»—. Va como nota y no
   * como mensaje público: es contexto para el equipo, no una explicación para quien espera.
   */
  async leaveHandoverSummary(tenantId: string, caseId: string, actor: SupportActor, summary?: string): Promise<void> {
    if (!summary) return;
    const channels = await this.channels.listChannelsForCase(caseId);
    const live = channels.find((channel) => !['CLOSED', 'ABANDONED'].includes(channel.status));
    if (!live) return;

    await this.messages.append({
      tenantId,
      channelId: String(live.id),
      actor,
      clientMessageId: `transfer-${caseId}-${Date.now()}`,
      body: summary,
      messageType: 'INTERNAL_NOTE',
      visibility: 'INTERNAL',
    });
  }

  async resolveClassification(
    tenantId: string,
    actor: SupportActor,
    supportCase: { categoryId: string | null; caseType: string; domain: string; impact: string; urgency: string; queueId: string | null },
    dto: TriageCaseDto,
    transaction: Transaction,
  ) {
    const category = dto.categoryCode ? await this.catalog.findCategoryByCode(tenantId, dto.categoryCode, { transaction }) : null;
    if (dto.categoryCode && !category) {
      throw new NotFoundException({ code: 'SUPPORT_CATEGORY_NOT_FOUND', categoryCode: dto.categoryCode });
    }
    // Reclasificar es la otra puerta al catálogo, y estaba tan abierta como la de apertura. Al agente
    // interno no se le limita: mover un caso entre audiencias es parte de su trabajo, y es
    // precisamente lo que hay que hacer cuando alguien abrió por el motivo equivocado.
    if (category) this.actors.assertCategoryAllowed(actor, category);

    const queue = await this.resolveQueue(tenantId, dto.queueCode, category?.defaultQueueId ?? null, transaction);
    const impact = (dto.impact ?? supportCase.impact) as SupportImpact;
    const urgency = (dto.urgency ?? supportCase.urgency) as SupportUrgency;
    const caseType = dto.caseType ?? supportCase.caseType;
    const derived = derivePriority({ impact, urgency, caseType: caseType as never });
    const priority = (dto.priority ? mostUrgent(dto.priority as SupportPriority, derived) : derived) as SupportPriority;

    return { category, queue, impact, urgency, caseType, priority };
  }

  /** La cola pedida a mano gana sobre la que trae la categoría; si no hay ninguna, se conserva la actual. */
  async resolveQueue(tenantId: string, queueCode: string | undefined, categoryQueueId: string | null, transaction: Transaction) {
    if (queueCode) return this.catalog.requireQueueByCode(tenantId, queueCode, { transaction });
    if (categoryQueueId) return this.catalog.findQueueById(tenantId, String(categoryQueueId), { transaction });
    return null;
  }
}
