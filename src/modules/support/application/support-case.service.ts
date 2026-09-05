/**
 * @file Servicio de aplicación: abrir y consultar el expediente de soporte.
 * @business Convierte «necesito ayuda» en un caso clasificado, enrutado y con plazos que se miden.
 * @system crea caso, referencias, relojes de SLA y el canal asíncrono con el relato inicial.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { SupportCaseModel } from '../../../database/models/index.js';
import { derivePriority } from '../domain/priority-policy.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import type { OpenCaseDto } from '../support-case.schemas.js';
import { NEVER_AUTO_CLOSE_CASE_TYPES, type SupportCaseType, type SupportImpact, type SupportUrgency } from '../support.constants.js';
import { toCategoryTreeDto, toCustomerCaseDto } from '../support.mapper.js';
import type { CaseSubject, OpenCaseInput } from './support-case-factory.service.js';
import { SupportActorService, type SupportActor } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseFactoryService } from './support-case-factory.service.js';
import { SupportSlaService } from './support-sla.service.js';

const DEFAULT_SLA_POLICY_CODE = 'atlas_support_default';

/** La categoría de red de seguridad: existe para que ninguna conversación se quede sin expediente. */
const UNCLASSIFIED_CATEGORY_CODE = 'OTHER';

@Injectable()
export class SupportCaseService {
  private readonly logger = new Logger(SupportCaseService.name);

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
   * El árbol de motivos que este actor puede usar para abrir un caso.
   *
   * `listCategories` existía, filtraba bien por audiencia y **no lo llamaba ningún controlador**:
   * el catálogo era inalcanzable desde el producto, así que ninguna pantalla podía ofrecer el motivo
   * aunque quisiera y toda la taxonomía dependía de que alguien escribiera el código a mano. Esa es
   * la razón de fondo por la que las conversaciones nacían sin caso.
   *
   * Las audiencias las deriva el servidor del actor, igual que en el conocimiento: si viajaran como
   * parámetro, pedir el catálogo del comercio sería tan fácil como cambiar una cadena en la URL.
   */
  async listCategories(input: { tenantId: string; actor: SupportActor }) {
    const categories = await this.catalog.listCategories(input.tenantId, this.actors.caseCategoryAudiences(input.actor));
    return { categories: toCategoryTreeDto(categories) };
  }

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
  /**
   * El expediente mínimo de una conversación que llegó sin caso.
   *
   * ## Por qué existe
   *
   * `POST /support/channels` admite abrir una conversación sin `caseId`, y las dos pantallas que
   * hay lo hacen así: la app llama `openChannel({})` y el portal manda sólo el comercio. El
   * resultado, medido sobre el VPS, era el 100 % de las conversaciones de comercio y el 11 % de las
   * de consumo sin expediente detrás: sin motivo, sin resolución, sin causa raíz y sin reloj. Toda
   * la analítica de soporte se construye sobre casos, así que lo que no llega a caso no existe.
   *
   * Arreglar sólo las pantallas no bastaría: una app instalada no se actualiza sola, y la que hay
   * en los teléfonos hoy seguirá abriendo canales sin caso durante meses. La garantía tiene que
   * estar en el servidor.
   *
   * ## Por qué el motivo es `OTHER` y no se adivina
   *
   * Porque adivinar el motivo a partir de nada produce datos peores que no tener motivo: una
   * categoría inventada por el sistema es indistinguible de una elegida por la persona cuando
   * alguien cuenta el informe. `OTHER` es explícito, se puede filtrar, y el caso nace pidiendo
   * triage a gritos: `triaged_at` en null es lo que lo separa de los que sí clasificó alguien.
   *
   * ## Por qué devuelve null en vez de fallar
   *
   * Si el catálogo no tiene `OTHER` —una base recién migrada sin sembrar, por ejemplo— la
   * alternativa sería no dejar hablar con soporte a quien lo necesita por una fila que falta. Se
   * registra el problema y la conversación sigue: un canal sin caso es un defecto de datos; un
   * cliente que no puede pedir ayuda es un defecto de producto.
   */
  async createUnclassifiedCase(input: {
    tenantId: string;
    actor: SupportActor;
    partnerProfileId?: string | null;
    transaction: Transaction;
  }): Promise<{ caseId: string; caseNumber: string } | null> {
    const category = await this.catalog.findCategoryByCode(input.tenantId, UNCLASSIFIED_CATEGORY_CODE, {
      transaction: input.transaction,
    });
    if (!category) {
      this.logger.warn(
        `No existe la categoría "${UNCLASSIFIED_CATEGORY_CODE}" en el tenant ${input.tenantId}: la conversación se abre sin expediente.`,
      );
      return null;
    }

    const dto = {
      categoryCode: category.categoryCode,
      title: 'Conversación sin clasificar',
      description: 'Abierta desde el chat de soporte. Pendiente de clasificar por un agente.',
      locale: 'es-BO',
      acknowledgeDuplicate: true,
      partnerProfileId: input.partnerProfileId ?? undefined,
    } as OpenCaseDto;

    const caseInput: OpenCaseInput = { tenantId: input.tenantId, actor: input.actor, dto, correlationId: null };
    const subject = this.resolveSubject(input.actor, dto);
    const caseType = (category.defaultCaseType ?? 'QUESTION') as SupportCaseType;
    const impact = category.defaultImpact as SupportImpact;
    const urgency = category.defaultUrgency as SupportUrgency;
    const priority = derivePriority({ impact, urgency, caseType });

    const queue = category.defaultQueueId
      ? await this.catalog.findQueueById(input.tenantId, String(category.defaultQueueId), { transaction: input.transaction })
      : null;
    const policy = await this.catalog.findActiveSlaPolicy(
      input.tenantId,
      queue?.slaPolicyCode ?? DEFAULT_SLA_POLICY_CODE,
      priority,
      { transaction: input.transaction },
    );

    const supportCase = await this.factory.insertCase(
      { input: caseInput, subject, category, queue, policy, caseType, impact, urgency, priority },
      input.transaction,
    );
    const caseId = String(supportCase.id);

    // El caso NO queda triado: lo abrió el sistema por una conversación, no lo clasificó nadie.
    await this.cases.update(input.tenantId, caseId, { triagedAt: null, status: 'NEW' }, { transaction: input.transaction });
    await this.sla.startClocks({
      tenantId: input.tenantId,
      caseId,
      policy,
      openedAt: new Date(),
      transaction: input.transaction,
    });

    await this.cases.appendEvent(
      {
        tenantId: input.tenantId,
        caseId,
        eventType: 'CASE_CREATED',
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        payload: {
          caseNumber: supportCase.caseNumber,
          caseType,
          priority,
          categoryCode: category.categoryCode,
          openedFromChannel: true,
          requiresTriage: true,
        },
      },
      input.transaction,
    );

    return { caseId, caseNumber: supportCase.caseNumber };
  }

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
