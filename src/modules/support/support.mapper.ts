/**
 * @file Mapper: convierte modelos de soporte en DTOs de transporte.
 * @business Decide qué ve el cliente y qué se queda dentro; el estado interno nunca sale en crudo.
 * @system funciones puras; ningún modelo Sequelize cruza la frontera HTTP.
 */
import type {
  KnowledgeArticleVersionModel,
  SupportAssignmentModel,
  SupportAttachmentModel,
  SupportCaseCategoryModel,
  SupportCaseEventModel,
  SupportCaseModel,
  SupportChannelModel,
  SupportMessageModel,
} from '../../database/models/index.js';
import { customerVisibleStatus } from './domain/case-state-machine.js';
import type { SupportCaseStatus } from './support.constants.js';

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/**
 * La ficha del caso tal como la ve quien lo abrió.
 *
 * No lleva `status` interno, ni cola, ni agente, ni resumen interno. No es una simplificación de la
 * interfaz: es la frontera. `WAITING_INTERNAL` le diría a una persona que su problema está detenido
 * por algo que no puede entender ni resolver, y el nombre del agente asignado convierte una cola de
 * trabajo en un directorio de empleados.
 */
export function toCustomerCaseDto(supportCase: SupportCaseModel) {
  return {
    caseId: String(supportCase.id),
    caseNumber: supportCase.caseNumber,
    title: supportCase.title,
    caseType: supportCase.caseType,
    domain: supportCase.domain,
    status: customerVisibleStatus(supportCase.status as SupportCaseStatus),
    summary: supportCase.publicSummary,
    openedAt: iso(supportCase.openedAt),
    firstResponseAt: iso(supportCase.firstResponseAt),
    resolvedAt: iso(supportCase.resolvedAt),
    closedAt: iso(supportCase.closedAt),
    lastActivityAt: iso(supportCase.lastActivityAt),
    reopenedCount: supportCase.reopenedCount,
  };
}

/** La ficha operativa. Añade lo que el equipo necesita para trabajar y medir. */
export function toInternalCaseDto(supportCase: SupportCaseModel) {
  return {
    ...toCustomerCaseDto(supportCase),
    internalStatus: supportCase.status,
    priority: supportCase.priority,
    impact: supportCase.impact,
    urgency: supportCase.urgency,
    sensitivity: supportCase.sensitivity,
    queueId: supportCase.queueId ? String(supportCase.queueId) : null,
    categoryId: supportCase.categoryId ? String(supportCase.categoryId) : null,
    assigneeAgentId: supportCase.currentAssigneeAgentId ? String(supportCase.currentAssigneeAgentId) : null,
    subjectContextType: supportCase.subjectContextType,
    subjectCustomerId: supportCase.subjectCustomerId ? String(supportCase.subjectCustomerId) : null,
    subjectPartnerProfileId: supportCase.subjectPartnerProfileId ? String(supportCase.subjectPartnerProfileId) : null,
    internalSummary: supportCase.internalSummary,
    escalationLevel: supportCase.escalationLevel,
    transferCount: supportCase.transferCount,
    legalHold: supportCase.legalHold,
    slaPolicyVersionId: supportCase.slaPolicyVersionId ? String(supportCase.slaPolicyVersionId) : null,
    retentionClassCode: supportCase.retentionClassCode,
    originContext: supportCase.originContextJson,
  };
}

/**
 * El árbol de motivos tal y como lo ve quien va a pedir ayuda.
 *
 * Se exponen etiqueta y descripción, y NO la cola, la sensibilidad, el impacto ni la urgencia por
 * defecto. No es celo innecesario: esos cuatro campos son la política interna de atención, y
 * publicarlos enseña a quien quiera colarse qué motivo elegir para caer en la cola especializada o
 * para nacer con prioridad alta. Quien abre un caso describe su problema; la consecuencia de esa
 * descripción la decide el servidor.
 */
export function toCategoryDto(category: SupportCaseCategoryModel) {
  return {
    categoryCode: category.categoryCode,
    label: category.label,
    description: category.description,
    requiresSpecialist: category.requiresSpecialist,
  };
}

/**
 * Motivo y submotivo, en dos niveles.
 *
 * El árbol se arma en memoria porque son decenas de filas ya cargadas y filtradas por audiencia:
 * una consulta recursiva aquí gastaría una ida a la base para ordenar lo que ya está en la mano.
 * Una categoría cuyo padre no esté en la lista —porque el padre es de otra audiencia o está
 * inactivo— sube a la raíz en vez de desaparecer: perder el motivo sería peor que perder su sitio
 * en la jerarquía.
 */
export function toCategoryTreeDto(categories: readonly SupportCaseCategoryModel[]) {
  const byId = new Map(categories.map((category) => [String(category.id), category]));
  const children = new Map<string, SupportCaseCategoryModel[]>();
  const roots: SupportCaseCategoryModel[] = [];

  for (const category of categories) {
    const parentId = category.parentCategoryId ? String(category.parentCategoryId) : null;
    if (parentId && byId.has(parentId)) {
      children.set(parentId, [...(children.get(parentId) ?? []), category]);
    } else {
      roots.push(category);
    }
  }

  return roots.map((root) => ({
    ...toCategoryDto(root),
    subcategories: (children.get(String(root.id)) ?? []).map(toCategoryDto),
  }));
}

export function toChannelDto(channel: SupportChannelModel) {
  return {
    channelId: String(channel.id),
    channelCode: channel.channelCode,
    caseId: channel.caseId ? String(channel.caseId) : null,
    channelType: channel.channelType,
    status: channel.status,
    requestedAt: iso(channel.requestedAt),
    openedAt: iso(channel.openedAt),
    closedAt: iso(channel.closedAt),
    closeReason: channel.closeReason,
    lastMessageSequence: String(channel.lastMessageSequence),
    hasAgent: Boolean(channel.assignedAgentProfileId),
  };
}

/**
 * Un mensaje, ya filtrado.
 *
 * `bodyText` puede venir redactado y el original cifrado no sale nunca por aquí. Se expone el
 * `integrityHash` a propósito: es lo que permite a un tercero verificar la transcripción exportada
 * sin tener que confiar en que el servidor la reprodujo fielmente.
 */
export function toMessageDto(message: SupportMessageModel, attachments: readonly SupportAttachmentModel[] = []) {
  return {
    messageId: String(message.id),
    sequence: String(message.serverSequence),
    clientMessageId: message.clientMessageId,
    senderActorType: message.senderActorType,
    messageType: message.messageType,
    visibility: message.visibility,
    body: message.bodyText,
    redacted: Boolean(message.redactedAt),
    redactionReason: message.redactionReason,
    createdAt: iso(message.createdAtValue),
    integrityHash: message.integrityHash,
    attachments: attachments.map((attachment) => ({
      attachmentId: String(attachment.id),
      filename: attachment.originalFilename,
      mime: attachment.detectedMime ?? attachment.declaredMime,
      sizeBytes: Number(attachment.sizeBytes),
      scanStatus: attachment.malwareScanStatus,
      sha256: attachment.sha256,
    })),
  };
}

export function toCaseEventDto(event: SupportCaseEventModel) {
  return {
    sequence: String(event.sequenceNumber),
    eventType: event.eventType,
    actorType: event.actorType,
    occurredAt: iso(event.occurredAt),
    payload: event.payloadJson,
    eventHash: event.eventHash,
  };
}

export function toAssignmentDto(assignment: SupportAssignmentModel) {
  return {
    assignmentId: String(assignment.id),
    assigneeType: assignment.assigneeType,
    agentProfileId: assignment.assigneeAgentProfileId ? String(assignment.assigneeAgentProfileId) : null,
    queueId: assignment.assigneeQueueId ? String(assignment.assigneeQueueId) : null,
    assignedAt: iso(assignment.assignedAt),
    releasedAt: iso(assignment.releasedAt),
    reason: assignment.assignmentReason,
    releaseReason: assignment.releaseReason,
  };
}

export function toKnowledgeVersionDto(version: KnowledgeArticleVersionModel, articleKey: string) {
  return {
    articleId: String(version.articleId),
    articleKey,
    versionId: String(version.id),
    versionNumber: version.versionNumber,
    locale: version.locale,
    status: version.status,
    title: version.title,
    question: version.question,
    shortAnswer: version.shortAnswer,
    body: version.bodyMarkdown,
    tags: version.tagsJson,
    escalateWhen: version.escalateWhen,
    publishedAt: iso(version.publishedAt),
    checksum: version.checksum,
  };
}
