/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza desacopla procesos de negocio y permite reintentos auditables sin perder eventos.
 * @system registra definiciones, outbox y procesamiento idempotente de eventos de dominio.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { decodeCursor, paginateWithCursor } from '../../common/utils/pagination/cursor-pagination.util.js';
import { listEventDefinitions, getEventDefinition } from './event-registry.js';
import { EventsRepository } from './events.repository.js';
import { ListEventsQueryDto, PublishEventDto } from './events.schemas.js';
import { ProcessEventsInput, ProcessEventsResult, PublishEventInput } from './event-types.js';
import { OutboxEventModel } from '../../database/models/index.js';
import { NotificationOrchestratorService } from '../notifications/notification-orchestrator.service.js';

function addBackoff(now: Date, attempts: number): Date {
  const minutes = Math.min(60, Math.max(1, attempts * attempts));
  return new Date(now.getTime() + minutes * 60_000);
}

function eventToResponse(event: OutboxEventModel): Record<string, unknown> {
  return {
    id: String(event.id),
    tenantId: event.tenantId === null ? null : String(event.tenantId),
    eventCode: event.eventCode,
    eventFamily: event.eventFamily,
    eventVersion: event.eventVersion,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    status: event.status,
    priority: event.priority ?? 0,
    attempts: event.attempts ?? 0,
    maxAttempts: event.maxAttempts ?? 3,
    availableAt: event.availableAt,
    processedAt: event.processedAt,
    failedAt: event.failedAt,
    errorCode: event.errorCode,
    lastError: event.lastError,
    idempotencyKey: event.idempotencyKey,
    correlationId: event.correlationId,
    causationId: event.causationId,
    sourceModule: event.sourceModule,
    sourceAction: event.sourceAction,
    payload: event.eventPayloadJson,
    metadata: event.metadataJson,
    createdAt: event.createdAtValue,
    updatedAt: event.updatedAtValue,
  };
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly repository: EventsRepository,
    private readonly notificationOrchestrator: NotificationOrchestratorService,
  ) {}

  listDefinitions() {
    return listEventDefinitions();
  }

  async publish(input: PublishEventInput) {
    const definition = getEventDefinition(input.eventCode);
    if (!definition) throw new BadRequestException(`EVENT_NOT_REGISTERED: ${input.eventCode}`);
    if (!definition.allowedAggregateTypes.includes(input.aggregateType)) {
      throw new BadRequestException(`EVENT_AGGREGATE_NOT_ALLOWED: ${input.eventCode} cannot use ${input.aggregateType}`);
    }
    const event = await this.repository.createEvent(input);
    return eventToResponse(event);
  }

  async publishFromDto(input: { tenantId: string; body: PublishEventDto; idempotencyKey?: string | null }) {
    return this.publish({
      tenantId: input.tenantId,
      eventCode: input.body.eventCode,
      aggregateType: input.body.aggregateType,
      aggregateId: input.body.aggregateId ?? null,
      payload: input.body.payload,
      metadata: input.body.metadata,
      priority: input.body.priority,
      availableAt: input.body.availableAt,
      maxAttempts: input.body.maxAttempts,
      idempotencyKey: input.body.idempotencyKey ?? input.idempotencyKey ?? null,
      correlationId: input.body.correlationId ?? null,
      causationId: input.body.causationId ?? null,
      sourceModule: input.body.sourceModule ?? 'operations_api',
      sourceAction: input.body.sourceAction ?? 'publish_event',
    });
  }

  async publishMany(inputs: PublishEventInput[]) {
    const results: Record<string, unknown>[] = [];
    for (const input of inputs) results.push(await this.publish(input));
    return { created: results.length, events: results };
  }

  async listEvents(tenantId: string, query: ListEventsQueryDto) {
    if (query.pagination === 'cursor') {
      const cursorKey = decodeCursor(query.cursor);
      if (query.cursor && !cursorKey) {
        throw new BadRequestException('cursor inválido o corrupto.');
      }
      const rowsPlusOne = await this.repository.listWithCursor(tenantId, query, cursorKey);
      const page = paginateWithCursor(rowsPlusOne, query.limit);
      return {
        data: page.items.map(eventToResponse),
        pagination: { mode: 'cursor' as const, limit: query.limit, nextCursor: page.nextCursor },
      };
    }

    const result = await this.repository.list(tenantId, query);
    return {
      data: result.rows.map(eventToResponse),
      pagination: {
        mode: 'offset' as const,
        page: query.page,
        limit: query.limit,
        total: result.count,
        totalPages: Math.ceil(result.count / query.limit),
      },
    };
  }

  async getEvent(tenantId: string, eventId: string) {
    return eventToResponse(await this.repository.getById(tenantId, eventId));
  }

  async retryEvent(tenantId: string, eventId: string) {
    const event = await this.repository.getById(tenantId, eventId);
    if (event.status === 'processed') throw new BadRequestException('PROCESSED_EVENT_CANNOT_BE_RETRIED');
    const now = new Date();
    event.status = 'pending';
    event.availableAt = now;
    event.failedAt = null;
    event.lastError = null;
    event.errorCode = null;
    // El presupuesto de intentos se devuelve al reintentar a mano. Sin esto, un evento que llegó a
    // `failed` por agotarlos volvía a `pending` con `attempts >= maxAttempts`: `claimPending` lo
    // reclamaba (sumando uno más) y el PRIMER fallo lo mandaba de vuelta a `failed` sin reintento
    // alguno. El operador que pulsa "reintentar" pide otra oportunidad real, no un intento único.
    event.attempts = 0;
    event.lockedAt = null;
    event.lockedBy = null;
    event.updatedAtValue = now;
    await event.save();
    return eventToResponse(event);
  }

  /**
   * Devuelve a la cola los eventos que quedaron bloqueados en `processing` porque el proceso que los
   * reclamó murió antes de resolverlos. Ver `EventsRepository.reclaimStuckProcessing` para el
   * porqué del criterio temporal y del destino según el presupuesto de intentos.
   */
  async reclaimStuckEvents(input: { tenantId: string; olderThanMinutes: number; limit: number; dryRun: boolean }) {
    const olderThan = new Date(Date.now() - input.olderThanMinutes * 60_000);

    if (input.dryRun) {
      const stuck = await this.repository.countStuckProcessing({ tenantId: input.tenantId, olderThan });
      return { selected: stuck, requeued: 0, deadLettered: 0, cutoff: olderThan.toISOString(), dryRun: true };
    }

    const outcome = await this.repository.reclaimStuckProcessing({ tenantId: input.tenantId, olderThan, limit: input.limit });
    if (outcome.eventIds.length > 0) {
      // Un evento varado nunca es normal: significa que un proceso murió a mitad de una entrega.
      // Se registra con los IDs para poder auditar qué se reprocesó y qué cayó a dead-letter.
      this.logger.warn(
        `Eventos varados recuperados (tenant=${input.tenantId}): ${outcome.requeued} devueltos a la cola, ` +
          `${outcome.deadLettered} a dead-letter. IDs: ${outcome.eventIds.join(', ')}.`,
      );
    }
    return {
      selected: outcome.eventIds.length,
      requeued: outcome.requeued,
      deadLettered: outcome.deadLettered,
      cutoff: olderThan.toISOString(),
      dryRun: false,
    };
  }

  async cancelEvent(tenantId: string, eventId: string) {
    const event = await this.repository.getById(tenantId, eventId);
    if (event.status === 'processed') throw new BadRequestException('PROCESSED_EVENT_CANNOT_BE_CANCELLED');
    const now = new Date();
    event.status = 'cancelled';
    event.updatedAtValue = now;
    await event.save();
    return eventToResponse(event);
  }

  async processPendingEvents(input: ProcessEventsInput): Promise<ProcessEventsResult> {
    const workerId = input.workerId ?? `db-backed-events-worker-${process.pid}`;
    const events = input.dryRun
      ? await this.repository.listPending({ tenantId: input.tenantId, limit: input.limit })
      : await this.repository.claimPending({ tenantId: input.tenantId, limit: input.limit, workerId });
    const result: ProcessEventsResult = {
      selected: events.length,
      processed: 0,
      failed: 0,
      skipped: 0,
      dryRun: input.dryRun,
      eventIds: events.map((event) => String(event.id)),
    };
    if (input.dryRun) return result;

    for (const event of events) {
      try {
        await this.notificationOrchestrator.handleEvent(event);

        event.status = 'processed';
        event.processedAt = new Date();
        event.lockedAt = null;
        event.lockedBy = null;
        event.updatedAtValue = new Date();
        await event.save();
        result.processed += 1;
      } catch (error) {
        const attempts = event.attempts ?? 1;
        const maxAttempts = event.maxAttempts ?? 3;
        const message = error instanceof Error ? error.message : 'UNKNOWN_EVENT_PROCESSING_ERROR';
        event.lockedAt = null;
        event.lockedBy = null;
        event.lastError = message;
        event.errorCode = 'EVENT_PROCESSING_FAILED';
        if (attempts >= maxAttempts) {
          event.status = 'failed';
          event.failedAt = new Date();
          result.failed += 1;
          // Sin este log, un evento que agota los reintentos solo dejaba rastro en la fila
          // (status='failed') — invisible para alertas/observabilidad. Se registra con stack.
          this.logger.error(
            `Evento ${String(event.id)} (${event.eventCode}) FALLIDO tras ${attempts}/${maxAttempts} intentos: ${message}`,
            error instanceof Error ? error.stack : undefined,
          );
        } else {
          event.status = 'pending';
          event.availableAt = addBackoff(new Date(), attempts);
          result.skipped += 1;
          this.logger.warn(`Evento ${String(event.id)} (${event.eventCode}) reintentará (${attempts}/${maxAttempts}): ${message}`);
        }
        event.updatedAtValue = new Date();
        await event.save();
      }
    }
    return result;
  }
}
