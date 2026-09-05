/**
 * @file Servicio de aplicación: abrir y consultar el expediente de soporte.
 * @business Convierte «necesito ayuda» en un caso clasificado, enrutado y con plazos que se miden.
 * @system crea caso, referencias, relojes de SLA y el canal asíncrono con el relato inicial.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { SupportCaseModel } from '../../../database/models/index.js';
import { derivePriority } from '../domain/priority-policy.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import type { OpenCaseDto } from '../support-case.schemas.js';
import { NEVER_AUTO_CLOSE_CASE_TYPES, type SupportCaseType, type SupportImpact, type SupportUrgency } from '../support.constants.js';
import { toCustomerCaseDto } from '../support.mapper.js';
import type { CaseSubject, OpenCaseInput } from './support-case-factory.service.js';
import { SupportActorService, type SupportActor } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseFactoryService } from './support-case-factory.service.js';
import { SupportSlaService } from './support-sla.service.js';

const DEFAULT_SLA_POLICY_CODE = 'atlas_support_default';

@Injectable()
export class SupportCaseService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly catalog: SupportCatalogRepository,
    private readonly cases: SupportCaseRepository,
    private readonly sla: SupportSlaService,
    private readonly audit: SupportAuditService,
    private readonly factory: SupportCaseFactoryService,
    private readonly actors: SupportActorService,
  ) {}

  /**
   * Abre un caso ya clasificado, con su canal y su primer mensaje.
   *
   * ## Por qué nace en TRIAGED y no en NEW
   *
   * Porque la categoría es obligatoria y ella trae cola, sensibilidad, impacto y prioridad: el caso
   * llega clasificado. Dejarlo en `NEW` obligaría a que alguien repitiera a mano una clasificación
   * que el catálogo ya hizo, y ese paso manual es donde los casos se quedan horas sin dueño.
   *
   * ## Por qué el relato inicial va como MENSAJE y no como campo del caso
   *
   * Porque lo que la persona escribió es evidencia de lo que comunicó, y la evidencia vive en la
   * transcripción inmutable. Como campo del expediente sería editable, y el primer relato es
   * justamente el que nadie debería poder retocar después.
   *
   * ## El aviso de duplicado no bloquea, avisa
   *
   * Si ya hay un caso abierto del mismo tipo se responde 409 con la lista, y el cliente puede
   * insistir con `acknowledgeDuplicate`. Bloquear de forma absoluta sería negarle a alguien reportar
   * un segundo problema real del mismo tipo; no avisar produce tres expedientes del mismo asunto y
   * tres agentes trabajando en paralelo.
   */
  async openCase(input: OpenCaseInput) {
    const category = await this.catalog.findCategoryByCode(input.tenantId, input.dto.categoryCode);
    if (!category) throw new NotFoundException({ code: 'SUPPORT_CATEGORY_NOT_FOUND', categoryCode: input.dto.categoryCode });
    this.actors.assertCategoryAllowed(input.actor, category);

    const caseType = (input.dto.caseType ?? category.defaultCaseType ?? 'QUESTION') as SupportCaseType;
    const impact = (input.dto.impact ?? category.defaultImpact) as SupportImpact;
    const urgency = (input.dto.urgency ?? category.defaultUrgency) as SupportUrgency;
    const priority = derivePriority({ impact, urgency, caseType });

    const queue = category.defaultQueueId ? await this.catalog.findQueueById(input.tenantId, String(category.defaultQueueId)) : null;
    const policy = await this.catalog.findActiveSlaPolicy(input.tenantId, queue?.slaPolicyCode ?? DEFAULT_SLA_POLICY_CODE, priority);

    const subject = this.resolveSubject(input.actor, input.dto);
    if (subject.contextType === 'CONSUMER' && !input.dto.acknowledgeDuplicate) {
      const open = await this.cases.findOpenCasesForCustomer(input.tenantId, subject.customerId as string, caseType);
      if (open.length) {
        throw new ConflictException({
          code: 'SUPPORT_CASE_POSSIBLE_DUPLICATE',
          message: 'Ya tienes un caso abierto de este tipo. Confirma si quieres abrir otro.',
          openCases: open.map(toCustomerCaseDto),
        });
      }
    }

    const created = await this.sequelize.transaction(async (transaction) => {
      const supportCase = await this.factory.insertCase(
        { input, subject, category, queue, policy, caseType, impact, urgency, priority },
        transaction,
      );
      const caseId = String(supportCase.id);

      await this.factory.linkReferences(input, caseId, transaction);
      await this.sla.startClocks({ tenantId: input.tenantId, caseId, policy, openedAt: new Date(), transaction });
      const channelId = await this.factory.openInitialChannel({ input, subject, queue, caseId }, transaction);

      await this.recordCreationEvents({
        input,
        caseId,
        caseNumber: supportCase.caseNumber,
        category,
        caseType,
        priority,
        queueCode: queue?.queueCode ?? null,
        channelId,
        transaction,
      });

      return { supportCase, channelId };
    });

    await this.publishCreation(input.tenantId, created.supportCase, caseType, input.correlationId ?? null);
    await this.audit.record({
      tenantId: input.tenantId,
      actor: input.actor,
      actionCode: 'support.case.open',
      targetType: 'support_case',
      targetId: String(created.supportCase.id),
      payload: { caseNumber: created.supportCase.caseNumber, caseType },
    });

    return { ...toCustomerCaseDto(created.supportCase), channelId: created.channelId };
  }

  /** Los avisos que salen del caso recién abierto. Un reclamo y un incidente además suenan aparte. */
  /**
   * Los tres hechos que quedan escritos al nacer un caso: se creó, quién lo clasificó y dónde se habla.
   *
   * ## Por qué el triage automático también es un evento
   *
   * El caso nace en `TRIAGED` con `triaged_at` puesto porque el motivo vino del catálogo y ya basta
   * para enrutar. Pero eso es la DECLARACIÓN de quien pide ayuda, no una clasificación revisada:
   * quien abre elige de una lista lo que cree que le pasa, y acierta menos de lo que el dato
   * sugiere —un cobro que no reconoce puede ser un fraude, un duplicado o su propia compra
   * olvidada, y los tres viven en motivos distintos—.
   *
   * Sin este evento la historia no distingue el caso que un agente revisó del que nadie miró, y el
   * tiempo de triage sale cero para todos: otro indicador perfecto que nadie investiga.
   * `automatic: true` es lo que hace medible «casos cuya clasificación nunca validó una persona»,
   * que es la cifra que de verdad dice si la taxonomía significa algo.
   */
  private async recordCreationEvents(input: {
    input: OpenCaseInput;
    caseId: string;
    caseNumber: string;
    category: { categoryCode: string };
    caseType: SupportCaseType;
    priority: string;
    queueCode: string | null;
    channelId: string;
    transaction: Transaction;
  }): Promise<void> {
    const { transaction, caseId, caseType, priority } = input;
    const tenantId = input.input.tenantId;
    const correlationId = input.input.correlationId ?? null;

    await this.cases.appendEvent(
      {
        tenantId,
        caseId,
        eventType: 'CASE_CREATED',
        actorType: input.input.actor.actorType,
        actorId: input.input.actor.actorId,
        payload: { caseNumber: input.caseNumber, caseType, priority, categoryCode: input.category.categoryCode },
        correlationId,
      },
      transaction,
    );

    await this.cases.appendEvent(
      {
        tenantId,
        caseId,
        eventType: 'CASE_TRIAGED',
        actorType: 'SYSTEM',
        actorId: null,
        payload: {
          automatic: true,
          classifiedBy: 'REQUESTER',
          categoryCode: input.category.categoryCode,
          caseType,
          priority,
          queueCode: input.queueCode,
          reason: 'Clasificación declarada por quien abrió el caso; pendiente de validación por un agente.',
        },
        correlationId,
      },
      transaction,
    );

    await this.cases.appendEvent(
      {
        tenantId,
        caseId,
        eventType: 'CHANNEL_OPENED',
        actorType: 'SYSTEM',
        actorId: null,
        payload: { channelId: input.channelId, channelType: 'ASYNC_MESSAGING' },
      },
      transaction,
    );
  }

  private async publishCreation(tenantId: string, supportCase: SupportCaseModel, caseType: SupportCaseType, correlationId: string | null) {
    const caseId = String(supportCase.id);
    await this.audit.publish({
      tenantId,
      eventCode: 'support.case.created',
      aggregateType: 'support_case',
      aggregateId: caseId,
      payload: { caseNumber: supportCase.caseNumber, caseType, priority: supportCase.priority },
      idempotencyKey: `support-case-created-${caseId}`,
      correlationId,
    });

    if (caseType === 'COMPLAINT') {
      await this.audit.publish({
        tenantId,
        eventCode: 'support.complaint.created',
        aggregateType: 'support_case',
        aggregateId: caseId,
        payload: { caseNumber: supportCase.caseNumber },
        idempotencyKey: `support-complaint-created-${caseId}`,
      });
    }
    if (NEVER_AUTO_CLOSE_CASE_TYPES.includes(caseType) && caseType !== 'COMPLAINT') {
      await this.audit.publish({
        tenantId,
        eventCode: 'support.security.escalated',
        aggregateType: 'support_case',
        aggregateId: caseId,
        payload: { caseNumber: supportCase.caseNumber, caseType },
        idempotencyKey: `support-security-${caseId}`,
      });
    }
  }

  /** El sujeto sale del ACTOR, nunca del cuerpo de la petición: si no, cualquiera abriría en nombre de otro. */
  private resolveSubject(actor: SupportActor, dto: OpenCaseDto): CaseSubject {
    if (actor.actorType === 'CUSTOMER') {
      return { contextType: 'CONSUMER' as const, customerId: actor.customerId, partnerProfileId: null };
    }
    if (actor.actorType === 'PARTNER_USER') {
      if (!dto.partnerProfileId) {
        throw new ConflictException({ code: 'SUPPORT_PARTNER_PROFILE_REQUIRED', message: 'Indica el comercio del caso.' });
      }
      return { contextType: 'PARTNER_USER' as const, customerId: null, partnerProfileId: dto.partnerProfileId };
    }
    return { contextType: 'INTERNAL' as const, customerId: null, partnerProfileId: dto.partnerProfileId ?? null };
  }
}
