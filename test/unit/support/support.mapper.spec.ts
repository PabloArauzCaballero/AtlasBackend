import { describe, expect, it } from '@jest/globals';
import {
  toAssignmentDto,
  toCaseEventDto,
  toCategoryDto,
  toCategoryTreeDto,
  toChannelDto,
  toCustomerCaseDto,
  toInternalCaseDto,
  toInternalCategoryDto,
  toInternalCategoryTreeDto,
  toKnowledgeVersionDto,
  toMessageDto,
  toQueueDto,
} from '../../../src/modules/support/support.mapper.js';
import type {
  KnowledgeArticleVersionModel,
  SupportAssignmentModel,
  SupportAttachmentModel,
  SupportCaseCategoryModel,
  SupportCaseEventModel,
  SupportCaseModel,
  SupportChannelModel,
  SupportMessageModel,
  SupportQueueModel,
} from '../../../src/database/models/index.js';

/**
 * La frontera de soporte.
 *
 * Un mapper parece cosmético y aquí no lo es: decide qué sale por HTTP. Lo que se fija son las dos
 * asimetrías deliberadas, que un refactor bienintencionado —«unificar las dos proyecciones»—
 * borraría sin que fallara ninguna prueba de las otras. Primero, la ficha del cliente NO lleva
 * estado interno, cola, agente ni resumen interno: `WAITING_INTERNAL` le diría a una persona que su
 * problema está detenido por algo que no puede resolver, y el nombre del agente convierte una cola
 * de trabajo en un directorio de empleados. Segundo, el catálogo de motivos oculta al cliente cola,
 * sensibilidad, impacto y urgencia por defecto: publicarlos enseña a quien quiera colarse qué motivo
 * elegir para caer en la cola especializada o para nacer con prioridad alta.
 */
function caso(overrides: Record<string, unknown> = {}): SupportCaseModel {
  return {
    id: 7,
    caseNumber: 'SC-0007',
    title: 'No me llega el código',
    caseType: 'INCIDENT',
    domain: 'AUTH',
    status: 'WAITING_INTERNAL',
    publicSummary: 'Estamos revisando el envío.',
    internalSummary: 'Proveedor SMS con cola atascada.',
    openedAt: new Date('2026-09-01T10:00:00Z'),
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    lastActivityAt: new Date('2026-09-02T10:00:00Z'),
    reopenedCount: 0,
    priority: 'HIGH',
    impact: 'MEDIUM',
    urgency: 'HIGH',
    sensitivity: 'NORMAL',
    queueId: 11,
    categoryId: 22,
    currentAssigneeAgentId: 33,
    subjectContextType: 'CUSTOMER',
    subjectCustomerId: 44,
    subjectPartnerProfileId: null,
    escalationLevel: 1,
    transferCount: 2,
    legalHold: false,
    slaPolicyVersionId: 55,
    retentionClassCode: 'STD',
    originContextJson: { canal: 'app' },
    ...overrides,
  } as unknown as SupportCaseModel;
}

function categoria(overrides: Record<string, unknown> = {}): SupportCaseCategoryModel {
  return {
    id: 1,
    categoryCode: 'AUTH',
    label: 'Acceso',
    description: 'Problemas para entrar',
    requiresSpecialist: false,
    parentCategoryId: null,
    audience: 'CUSTOMER',
    domain: 'AUTH',
    defaultCaseType: 'INCIDENT',
    sensitivity: 'NORMAL',
    defaultQueueId: 99,
    defaultImpact: 'LOW',
    defaultUrgency: 'LOW',
    catalogVersion: 3,
    ...overrides,
  } as unknown as SupportCaseCategoryModel;
}

describe('mapper de soporte', () => {
  describe('la ficha del caso', () => {
    it('la del cliente traduce el estado interno y no deja salir ninguno de los campos operativos', () => {
      const dto = toCustomerCaseDto(caso());

      expect(dto.status).toBe('Estamos investigando');
      for (const prohibido of ['internalStatus', 'queueId', 'assigneeAgentId', 'internalSummary', 'priority', 'escalationLevel']) {
        expect(dto).not.toHaveProperty(prohibido);
      }
      expect(dto.summary).toBe('Estamos revisando el envío.');
    });

    it('un estado que el catálogo no traduce cae en «En revisión» en vez de filtrar el código', () => {
      expect(toCustomerCaseDto(caso({ status: 'ALGO_NUEVO' as never })).status).toBe('En revisión');
    });

    it('las fechas salen en ISO y las ausentes como nulo, no como cadena vacía', () => {
      const dto = toCustomerCaseDto(caso({ openedAt: new Date('2026-09-01T10:00:00Z'), resolvedAt: null }));

      expect(dto.openedAt).toBe('2026-09-01T10:00:00.000Z');
      expect(dto.resolvedAt).toBeNull();
      expect(dto.firstResponseAt).toBeNull();
    });

    it('la operativa añade lo interno sin pisar el estado que ve el cliente', () => {
      const dto = toInternalCaseDto(caso());

      expect(dto.status).toBe('Estamos investigando');
      expect(dto.internalStatus).toBe('WAITING_INTERNAL');
      expect(dto.queueId).toBe('11');
      expect(dto.assigneeAgentId).toBe('33');
      expect(dto.internalSummary).toBe('Proveedor SMS con cola atascada.');
      expect(dto.originContext).toEqual({ canal: 'app' });
    });

    it('los identificadores ausentes viajan como nulo y los presentes como texto, nunca como número', () => {
      const dto = toInternalCaseDto(
        caso({
          queueId: null,
          categoryId: null,
          currentAssigneeAgentId: null,
          subjectPartnerProfileId: 66,
          slaPolicyVersionId: null,
        } as never),
      );

      expect(dto.queueId).toBeNull();
      expect(dto.categoryId).toBeNull();
      expect(dto.assigneeAgentId).toBeNull();
      expect(dto.slaPolicyVersionId).toBeNull();
      expect(dto.subjectPartnerProfileId).toBe('66');
      expect(dto.subjectCustomerId).toBe('44');
    });
  });

  describe('el catálogo de motivos', () => {
    it('al cliente sólo le llegan etiqueta, descripción y si necesita especialista', () => {
      expect(toCategoryDto(categoria())).toEqual({
        categoryCode: 'AUTH',
        label: 'Acceso',
        description: 'Problemas para entrar',
        requiresSpecialist: false,
      });
    });

    it('a quien clasifica sí le llega a dónde manda el caso: cola, sensibilidad, impacto y urgencia', () => {
      const dto = toInternalCategoryDto(categoria());

      expect(dto.defaultQueueId).toBe('99');
      expect(dto.sensitivity).toBe('NORMAL');
      expect(dto.defaultImpact).toBe('LOW');
      expect(dto.defaultUrgency).toBe('LOW');
      expect(dto.audience).toBe('CUSTOMER');
      expect(dto.categoryId).toBe('1');
    });

    it('una categoría sin cola por defecto la declara nula', () => {
      expect(toInternalCategoryDto(categoria({ defaultQueueId: null })).defaultQueueId).toBeNull();
    });

    it('el árbol anida los submotivos bajo su motivo y no publica la política interna', () => {
      const arbol = toCategoryTreeDto([
        categoria({ id: 1, categoryCode: 'AUTH', label: 'Acceso' }),
        categoria({ id: 2, categoryCode: 'AUTH_SMS', label: 'No llega el SMS', parentCategoryId: 1 }),
      ]);

      expect(arbol).toHaveLength(1);
      expect(arbol[0].subcategories.map((s) => s.categoryCode)).toEqual(['AUTH_SMS']);
      expect(arbol[0].subcategories[0]).not.toHaveProperty('defaultQueueId');
    });

    it('un motivo cuyo padre no está en la lista sube a la raíz en vez de desaparecer', () => {
      const arbol = toCategoryTreeDto([categoria({ id: 2, categoryCode: 'AUTH_SMS', parentCategoryId: 99 })]);

      expect(arbol.map((raiz) => raiz.categoryCode)).toEqual(['AUTH_SMS']);
    });

    it('el árbol del triage tiene la misma forma pero con la proyección interna en los dos niveles', () => {
      const arbol = toInternalCategoryTreeDto([
        categoria({ id: 1, categoryCode: 'AUTH' }),
        categoria({ id: 2, categoryCode: 'AUTH_SMS', parentCategoryId: 1, defaultQueueId: 77 }),
      ]);

      expect(arbol[0].defaultQueueId).toBe('99');
      expect(arbol[0].subcategories[0].defaultQueueId).toBe('77');
    });

    it('varios submotivos del mismo padre conservan el orden de llegada', () => {
      const arbol = toCategoryTreeDto([
        categoria({ id: 1, categoryCode: 'AUTH' }),
        categoria({ id: 2, categoryCode: 'B', parentCategoryId: 1 }),
        categoria({ id: 3, categoryCode: 'C', parentCategoryId: 1 }),
      ]);

      expect(arbol[0].subcategories.map((s) => s.categoryCode)).toEqual(['B', 'C']);
    });
  });

  describe('cola, canal y asignación', () => {
    it('la cola declara a qué se compromete y no rompe cuando no exige destrezas', () => {
      const dto = toQueueDto({
        id: 11,
        queueCode: 'AUTH_L1',
        name: 'Acceso nivel 1',
        description: null,
        contextType: 'CUSTOMER',
        defaultPriority: 'NORMAL',
        slaPolicyCode: 'SLA_STD',
        skillsRequiredJson: null,
      } as unknown as SupportQueueModel);

      expect(dto.queueId).toBe('11');
      expect(dto.skillsRequired).toEqual([]);
      expect(dto.slaPolicyCode).toBe('SLA_STD');
    });

    it('el canal dice si ya hay agente sin decir quién es', () => {
      const conAgente = toChannelDto({
        id: 5,
        channelCode: 'CH-5',
        caseId: 7,
        channelType: 'CHAT',
        status: 'OPEN',
        requestedAt: new Date('2026-09-01T10:00:00Z'),
        openedAt: null,
        closedAt: null,
        closeReason: null,
        lastMessageSequence: 12,
        assignedAgentProfileId: 33,
      } as unknown as SupportChannelModel);

      expect(conAgente.hasAgent).toBe(true);
      expect(conAgente).not.toHaveProperty('assignedAgentProfileId');
      expect(conAgente.lastMessageSequence).toBe('12');
      expect(conAgente.caseId).toBe('7');
    });

    it('un canal sin caso ni agente lo declara sin inventar identificadores', () => {
      const dto = toChannelDto({
        id: 5,
        caseId: null,
        lastMessageSequence: 0,
        assignedAgentProfileId: null,
        requestedAt: null,
        openedAt: null,
        closedAt: null,
      } as unknown as SupportChannelModel);

      expect(dto.caseId).toBeNull();
      expect(dto.hasAgent).toBe(false);
      expect(dto.requestedAt).toBeNull();
    });

    it('la asignación distingue agente de cola y conserva por qué terminó', () => {
      const dto = toAssignmentDto({
        id: 3,
        assigneeType: 'AGENT',
        assigneeAgentProfileId: 33,
        assigneeQueueId: null,
        assignedAt: new Date('2026-09-01T10:00:00Z'),
        releasedAt: new Date('2026-09-02T10:00:00Z'),
        assignmentReason: 'TRIAGE',
        releaseReason: 'REASSIGNED',
      } as unknown as SupportAssignmentModel);

      expect(dto.agentProfileId).toBe('33');
      expect(dto.queueId).toBeNull();
      expect(dto.releaseReason).toBe('REASSIGNED');
      expect(dto.releasedAt).toBe('2026-09-02T10:00:00.000Z');
    });
  });

  describe('mensajes y eventos', () => {
    it('el mensaje sale con su hash de integridad: es lo que deja verificar la transcripción exportada', () => {
      const dto = toMessageDto({
        id: 9,
        serverSequence: 4,
        clientMessageId: 'uuid-1',
        senderActorType: 'customer',
        messageType: 'TEXT',
        visibility: 'PUBLIC',
        bodyText: 'Hola',
        redactedAt: null,
        redactionReason: null,
        createdAtValue: new Date('2026-09-01T10:00:00Z'),
        integrityHash: 'abc123',
      } as unknown as SupportMessageModel);

      expect(dto.integrityHash).toBe('abc123');
      expect(dto.redacted).toBe(false);
      expect(dto.sequence).toBe('4');
      expect(dto.attachments).toEqual([]);
    });

    it('un mensaje redactado lo declara y conserva el motivo', () => {
      const dto = toMessageDto({
        id: 9,
        serverSequence: 4,
        redactedAt: new Date('2026-09-02T10:00:00Z'),
        redactionReason: 'PII',
        bodyText: '[redactado]',
        createdAtValue: null,
      } as unknown as SupportMessageModel);

      expect(dto.redacted).toBe(true);
      expect(dto.redactionReason).toBe('PII');
      expect(dto.createdAt).toBeNull();
    });

    it('el adjunto prefiere el tipo DETECTADO al declarado: el declarado lo escribe quien sube', () => {
      const adjuntos = [
        {
          id: 1,
          originalFilename: 'a.pdf',
          detectedMime: 'application/pdf',
          declaredMime: 'image/png',
          sizeBytes: '1024',
          malwareScanStatus: 'CLEAN',
          sha256: 'h1',
        },
        {
          id: 2,
          originalFilename: 'b.bin',
          detectedMime: null,
          declaredMime: 'application/octet-stream',
          sizeBytes: '2048',
          malwareScanStatus: 'PENDING',
          sha256: 'h2',
        },
      ] as unknown as SupportAttachmentModel[];

      const dto = toMessageDto({ id: 9, serverSequence: 4, createdAtValue: null } as unknown as SupportMessageModel, adjuntos);

      expect(dto.attachments.map((a) => a.mime)).toEqual(['application/pdf', 'application/octet-stream']);
      expect(dto.attachments[0].sizeBytes).toBe(1024);
      expect(dto.attachments[0].scanStatus).toBe('CLEAN');
    });

    it('el evento del caso lleva su hash encadenado y su secuencia como texto', () => {
      const dto = toCaseEventDto({
        sequenceNumber: 12,
        eventType: 'STATUS_CHANGED',
        actorType: 'internal_user',
        occurredAt: new Date('2026-09-01T10:00:00Z'),
        payloadJson: { de: 'NEW', a: 'TRIAGED' },
        eventHash: 'h-12',
      } as unknown as SupportCaseEventModel);

      expect(dto).toEqual({
        sequence: '12',
        eventType: 'STATUS_CHANGED',
        actorType: 'internal_user',
        occurredAt: '2026-09-01T10:00:00.000Z',
        payload: { de: 'NEW', a: 'TRIAGED' },
        eventHash: 'h-12',
      });
    });
  });

  describe('artículo de la base de conocimiento', () => {
    it('la versión lleva la clave del artículo, que no vive en la fila de la versión', () => {
      const dto = toKnowledgeVersionDto(
        {
          articleId: 2,
          id: 8,
          versionNumber: 3,
          locale: 'es-BO',
          status: 'PUBLISHED',
          title: 'Cómo recuperar el acceso',
          question: '¿No te llega el código?',
          shortAnswer: 'Revisa la señal.',
          bodyMarkdown: '# Pasos',
          tagsJson: ['auth'],
          escalateWhen: 'Si persiste tras 3 intentos',
          publishedAt: new Date('2026-09-01T10:00:00Z'),
          checksum: 'c1',
        } as unknown as KnowledgeArticleVersionModel,
        'auth.recuperar-acceso',
      );

      expect(dto.articleKey).toBe('auth.recuperar-acceso');
      expect(dto.articleId).toBe('2');
      expect(dto.versionId).toBe('8');
      expect(dto.publishedAt).toBe('2026-09-01T10:00:00.000Z');
      expect(dto.checksum).toBe('c1');
    });

    it('un borrador sin publicar declara la fecha nula en vez de omitirla', () => {
      const dto = toKnowledgeVersionDto(
        { articleId: 2, id: 8, status: 'DRAFT', publishedAt: null } as unknown as KnowledgeArticleVersionModel,
        'k',
      );

      expect(dto.status).toBe('DRAFT');
      expect(dto.publishedAt).toBeNull();
    });
  });
});
