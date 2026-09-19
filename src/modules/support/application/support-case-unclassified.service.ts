/**
 * @file El caso que se abre SIN motivo, para no dejar a nadie sin poder escribir.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { derivePriority } from '../domain/priority-policy.js';
import { SupportCatalogRepository } from '../support-catalog.repository.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import type { OpenCaseDto } from '../support-case.schemas.js';
import { type SupportCaseType, type SupportImpact, type SupportUrgency } from '../support.constants.js';

import type { CaseSubject, OpenCaseInput } from './support-case-factory.service.js';
import { SupportActorService, type SupportActor } from './support-actor.service.js';
import { SupportAuditService } from './support-audit.service.js';
import { SupportCaseFactoryService } from './support-case-factory.service.js';
import { SupportSlaService } from './support-sla.service.js';
import { SupportCaseCreationEventsService } from './support-case-creation-events.service.js';

const DEFAULT_SLA_POLICY_CODE = 'atlas_support_default';

/** La categoría de red de seguridad: existe para que ninguna conversación se quede sin expediente. */
const UNCLASSIFIED_CATEGORY_CODE = 'OTHER';

/**
 * Sale de `SupportCaseService` porque es el camino excepcional y el más largo: cuando quien pide
 * ayuda no eligió categoría, hay que inventarle una cola, dejar dicho que está sin clasificar y que
 * alguien la clasifique después. Mezclado con el alta normal, tapaba cuál de los dos se estaba
 * leyendo.
 */
@Injectable()
export class SupportCaseUnclassifiedService {
  private readonly logger = new Logger(SupportCaseUnclassifiedService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly catalog: SupportCatalogRepository,
    private readonly cases: SupportCaseRepository,
    private readonly sla: SupportSlaService,
    private readonly audit: SupportAuditService,
    private readonly factory: SupportCaseFactoryService,
    private readonly actors: SupportActorService,
    private readonly eventosDeApertura: SupportCaseCreationEventsService,
  ) {}

  async createUnclassifiedCase(input: {
    tenantId: string;
    actor: SupportActor;
    partnerProfileId?: string | null;
    /**
     * El motivo que la persona eligió al abrir el chat, si eligió alguno.
     *
     * Sin esto el motivo se usaba SÓLO para elegir la cola y se tiraba a la hora de clasificar: el
     * caso nacía siempre en `OTHER` aunque la persona hubiera dicho de qué se trataba. La analítica
     * de motivos salía vacía no porque nadie eligiera, sino porque su elección no llegaba al
     * expediente. Se valida contra la audiencia del actor igual que al abrir un caso: si el motivo
     * no le corresponde, se cae a `OTHER` en vez de rechazar la conversación.
     */
    categoryCode?: string | null;
    transaction: Transaction;
  }): Promise<{ caseId: string; caseNumber: string } | null> {
    const category = await this.resolveChannelCategory(input.tenantId, input.actor, input.categoryCode, input.transaction);
    if (!category) {
      this.logger.warn(
        `No existe la categoría "${UNCLASSIFIED_CATEGORY_CODE}" en el tenant ${input.tenantId}: la conversación se abre sin expediente.`,
      );
      return null;
    }

    const clasificado = category.categoryCode !== UNCLASSIFIED_CATEGORY_CODE;
    const dto = {
      categoryCode: category.categoryCode,
      title: clasificado ? category.label : 'Conversación sin clasificar',
      description: clasificado
        ? `Abierta desde el chat de soporte con el motivo "${category.label}".`
        : 'Abierta desde el chat de soporte. Pendiente de clasificar por un agente.',
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
    const policy = await this.catalog.findActiveSlaPolicy(input.tenantId, queue?.slaPolicyCode ?? DEFAULT_SLA_POLICY_CODE, priority, {
      transaction: input.transaction,
    });

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
  /**
   * El motivo elegido, si vale para este actor; si no, la red de seguridad.
   *
   * Se cae a `OTHER` en vez de lanzar `SUPPORT_CATEGORY_NOT_ALLOWED` porque aquí el usuario ya está
   * abriendo una conversación: rechazarla por un código que no le corresponde —un cliente viejo con
   * el catálogo cacheado, por ejemplo— le dejaría sin poder pedir ayuda por un problema que no es
   * suyo. Abrir un caso SÍ rechaza, y con razón: allí el motivo es el dato principal.
   */
  private async resolveChannelCategory(
    tenantId: string,
    actor: SupportActor,
    categoryCode: string | null | undefined,
    transaction: Transaction,
  ) {
    if (categoryCode) {
      const elegida = await this.catalog.findCategoryByCode(tenantId, categoryCode, { transaction });
      const audiencias = this.actors.caseCategoryAudiences(actor);
      if (elegida && audiencias.includes(elegida.audience)) return elegida;
    }
    return this.catalog.findCategoryByCode(tenantId, UNCLASSIFIED_CATEGORY_CODE, { transaction });
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
