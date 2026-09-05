/**
 * @file Servicio de aplicación: escribe las filas que componen un caso recién abierto.
 * @business Un expediente nuevo son cuatro cosas a la vez: el caso, sus referencias, su canal y su relato.
 * @system separa la ESCRITURA de la decisión: aquí no se decide nada, se persiste lo ya decidido.
 */
import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import type { SupportCaseCategoryModel, SupportQueueModel, SupportSlaPolicyModel } from '../../../database/models/index.js';
import { generateCaseNumber, generateChannelCode } from '../domain/case-number.util.js';
import type { derivePriority } from '../domain/priority-policy.js';
import { SupportCaseRepository } from '../support-case.repository.js';
import { SupportCaseTimelineRepository } from '../support-case-timeline.repository.js';
import { SupportChannelRepository } from '../support-channel.repository.js';
import type { OpenCaseDto } from '../support-case.schemas.js';
import {
  SECURITY_SENSITIVE_CASE_TYPES,
  SUPPORT_RETENTION_CLASSES,
  type SupportCaseType,
  type SupportImpact,
  type SupportSensitivity,
  type SupportUrgency,
} from '../support.constants.js';
import type { SupportActor } from './support-actor.service.js';
import { SupportMessageService } from './support-message.service.js';

/**
 * La clase de retención con la que nace el expediente.
 *
 * Se decide por el TIPO de caso y no por quien lo abre: un reclamo formal y un incidente de
 * seguridad se conservan por razones distintas del resto, y esa razón no depende de si lo planteó
 * un cliente o un comercio.
 */
const SENSITIVITY_ORDER: readonly SupportSensitivity[] = ['NORMAL', 'SENSITIVE', 'RESTRICTED'];

/**
 * La sensibilidad con la que nace el caso, que el catálogo puede subir pero nunca bajar.
 *
 * `SECURITY_SENSITIVE_CASE_TYPES` existía desde el principio y **sólo se usaba para subir la
 * prioridad**: la sensibilidad real salía tal cual de `category.sensitivity`. El README del módulo,
 * mientras tanto, prometía que estos casos «nacen con visibilidad restringida y cola especializada,
 * sin esperar a que alguien lo note». Funcionaba de casualidad, porque las categorías de fraude y
 * seguridad venían sembradas restringidas; en cuanto una no lo estaba, la promesa era falsa.
 *
 * La auditoría del 2026-09-05 encontró el hueco abierto: `AUTH` y `AUTH_OTP_NOT_RECEIVED` producen
 * `ACCOUNT_ACCESS` —un tipo sensible— y están sembradas `NORMAL` en la cola de consumo. Los dos
 * casos reales de ese tipo heredaron esa marca, así que un intento de acceso a la cuenta de alguien
 * quedó con la misma protección que una consulta de cuotas.
 *
 * Que la garantía viva aquí y no en la siembra es la diferencia entre una propiedad del sistema y
 * una coincidencia de configuración: el catálogo puede endurecer, nunca ablandar.
 */
function sensitivityFor(caseType: SupportCaseType, categorySensitivity: string): SupportSensitivity {
  const fromCatalog = (
    SENSITIVITY_ORDER.includes(categorySensitivity as SupportSensitivity) ? categorySensitivity : 'NORMAL'
  ) as SupportSensitivity;
  const floor: SupportSensitivity = SECURITY_SENSITIVE_CASE_TYPES.includes(caseType) ? 'SENSITIVE' : 'NORMAL';
  return SENSITIVITY_ORDER.indexOf(fromCatalog) >= SENSITIVITY_ORDER.indexOf(floor) ? fromCatalog : floor;
}

function retentionClassFor(caseType: SupportCaseType): string {
  if (caseType === 'COMPLAINT') return SUPPORT_RETENTION_CLASSES.COMPLAINT;
  if (caseType === 'SECURITY_INCIDENT' || caseType === 'FRAUD_REPORT') return SUPPORT_RETENTION_CLASSES.SECURITY_INCIDENT;
  if (caseType === 'PRIVACY_REQUEST') return SUPPORT_RETENTION_CLASSES.PRIVACY;
  if (caseType === 'PAYMENT_EVIDENCE' || caseType === 'RECONCILIATION_SUPPORT') return SUPPORT_RETENTION_CLASSES.FINANCIAL_EVIDENCE;
  return SUPPORT_RETENTION_CLASSES.GENERAL;
}

/** Lo que pide quien abre un caso, ya resuelto el actor desde el token. */
export interface OpenCaseInput {
  tenantId: string;
  actor: SupportActor;
  dto: OpenCaseDto;
  correlationId?: string | null;
}

/** El sujeto del expediente: sale del actor, nunca del cuerpo de la petición. */
export interface CaseSubject {
  contextType: 'CONSUMER' | 'PARTNER_USER' | 'INTERNAL';
  customerId: string | null;
  partnerProfileId: string | null;
}

/** Todo lo que la clasificación decidió antes de escribir la primera fila. */
export interface NewCaseContext {
  input: OpenCaseInput;
  subject: CaseSubject;
  category: SupportCaseCategoryModel;
  queue: SupportQueueModel | null;
  policy: SupportSlaPolicyModel | null;
  caseType: SupportCaseType;
  impact: SupportImpact;
  urgency: SupportUrgency;
  priority: ReturnType<typeof derivePriority>;
}

export interface InitialChannelContext {
  input: OpenCaseInput;
  subject: CaseSubject;
  queue: SupportQueueModel | null;
  caseId: string;
}

@Injectable()
export class SupportCaseFactoryService {
  constructor(
    private readonly cases: SupportCaseRepository,
    private readonly timeline: SupportCaseTimelineRepository,
    private readonly channels: SupportChannelRepository,
    private readonly messages: SupportMessageService,
  ) {}

  /** La fila del expediente, con todo lo que la categoría y la cola ya decidieron por él. */
  insertCase(context: NewCaseContext, transaction: Transaction) {
    const { input, subject, category, queue, policy, caseType, impact, urgency, priority } = context;
    const now = new Date();
    return this.cases.create(
      {
        tenantId: input.tenantId,
        caseNumber: generateCaseNumber(),
        subjectContextType: subject.contextType,
        subjectCustomerId: subject.customerId,
        subjectPartnerProfileId: subject.partnerProfileId,
        openedByActorType: input.actor.actorType,
        openedByActorId: input.actor.actorId,
        requesterDisplayName: input.actor.displayName,
        originChannel: subject.contextType === 'CONSUMER' ? 'MOBILE_APP' : 'PARTNER_PORTAL',
        caseType,
        domain: input.dto.domain ?? category.domain,
        categoryId: String(category.id),
        priority,
        impact,
        urgency,
        sensitivity: sensitivityFor(caseType, category.sensitivity),
        status: 'TRIAGED',
        queueId: queue ? String(queue.id) : null,
        title: input.dto.title,
        publicSummary: null,
        internalSummary: null,
        partnerVisibility: subject.contextType === 'CONSUMER' ? 'PRIVATE_TO_REQUESTER' : 'PARTNER_TEAM',
        locale: input.dto.locale,
        originContextJson: input.dto.originContext ?? null,
        openedAt: now,
        triagedAt: now,
        lastActivityAt: now,
        reopenedCount: 0,
        transferCount: 0,
        escalationLevel: 0,
        slaPolicyVersionId: policy ? String(policy.id) : null,
        retentionClassCode: retentionClassFor(caseType),
        legalHold: false,
        lastEventSequence: '0',
        correlationId: input.correlationId ?? null,
        deleted: false,
      },
      { transaction },
    );
  }

  /** Los punteros a lo que el caso trata: se referencia la entidad de Atlas, nunca se copia. */
  async linkReferences(input: OpenCaseInput, caseId: string, transaction: Transaction): Promise<void> {
    for (const reference of input.dto.references ?? []) {
      await this.timeline.createReference(
        {
          tenantId: input.tenantId,
          caseId,
          entityType: reference.entityType,
          entityId: reference.entityId,
          relationType: reference.relationType,
          snapshotLabel: reference.snapshotLabel ?? null,
          createdByActorId: input.actor.actorId,
        },
        { transaction },
      );
    }
  }

  /**
   * El canal asíncrono del caso, con el relato inicial ya dentro.
   *
   * Nace `QUEUED` y no `OPEN`: todavía no hay agente. Y el primer mensaje entra por el mismo camino
   * que cualquier otro —con su hash y su secuencia— porque es evidencia igual que el resto.
   */
  async openInitialChannel(context: InitialChannelContext, transaction: Transaction): Promise<string> {
    const { input, subject, queue, caseId } = context;
    const channel = await this.channels.create(
      {
        tenantId: input.tenantId,
        channelCode: generateChannelCode(),
        caseId,
        channelType: 'ASYNC_MESSAGING',
        subjectContextType: subject.contextType,
        subjectCustomerId: subject.customerId,
        subjectPartnerProfileId: subject.partnerProfileId,
        status: 'QUEUED',
        queueId: queue ? String(queue.id) : null,
        requestedAt: new Date(),
        lastActivityAt: new Date(),
        lastMessageSequence: '0',
        claimVersion: 0,
        locale: input.dto.locale,
        deleted: false,
      },
      { transaction },
    );

    await this.channels.addParticipant(
      {
        tenantId: input.tenantId,
        channelId: String(channel.id),
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        roleInChannel: 'REQUESTER',
        joinedAt: new Date(),
        joinReason: 'case_opened',
      },
      { transaction },
    );

    await this.messages.append(
      {
        tenantId: input.tenantId,
        channelId: String(channel.id),
        actor: input.actor,
        clientMessageId: `case-${caseId}-initial`,
        body: input.dto.description,
        messageType: 'TEXT',
        visibility: 'PUBLIC',
        correlationId: input.correlationId ?? null,
      },
      transaction,
    );

    return String(channel.id);
  }
}
