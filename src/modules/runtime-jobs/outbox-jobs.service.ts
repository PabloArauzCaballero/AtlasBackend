/**
 * @file Servicio de aplicación: trabajos de fondo del outbox de eventos.
 * @business Drena el outbox y procesa los eventos de negocio pendientes fuera de la latencia del request.
 * @system reclama filas con SKIP LOCKED, publica el backlog y delega los eventos de negocio en EventsService.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { MetricsService } from '../../common/observability/metrics.service.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { OutboxEventModel } from '../../database/models/index.js';
import { listEventDefinitions } from '../events/event-registry.js';
import { EventsService } from '../events/events.service.js';
import { JobRunRecorderService } from './job-run-recorder.service.js';
import { countOutboxBacklog, publishOutboxBacklog } from './outbox-backlog.js';
import { type ClaimedOutboxRow, reportUnregisteredDomainEvents, tallyUnregisteredDomainEvents } from './outbox-unregistered.js';
import { ProcessEventsDto, ProcessOutboxDto } from './runtime-jobs.schemas.js';

function registeredEventCodesOrSentinel(): string[] {
  const codes = listEventDefinitions().map((event) => event.code);
  // `NOT IN (:codes)` con un arreglo vacío es SQL inválido; un valor centinela que nunca
  // coincide con un event_code real preserva la semántica "excluir ninguno" de forma segura.
  return codes.length > 0 ? codes : ['__no_registered_events__'];
}

@Injectable()
export class OutboxJobsService {
  private readonly logger = new Logger(OutboxJobsService.name);

  constructor(
    @InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly eventsService: EventsService,
    private readonly jobRuns: JobRunRecorderService,
    // Fase 3.4: publica la profundidad del backlog del outbox. `@Optional()` y último a propósito:
    // varios tests construyen este servicio posicionalmente y no deben romperse por instrumentar.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Reclama con `SELECT ... FOR UPDATE SKIP LOCKED` (dos corridas no se solapan) los eventos del inquilino Y los
   * SIN inquilino: mutaciones anónimas (login, refresh, logout) que ninguna corrida tomaba nunca. Sin efecto de negocio.
   */
  async processOutbox(input: { tenantId: string; body: ProcessOutboxDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'process_outbox', body: input.body, currentUser: input.currentUser },
      async () => {
        const excludedCodes = registeredEventCodesOrSentinel();

        if (input.body.dryRun) {
          // Modo solo-lectura: no hay ninguna escritura que proteger con bloqueo de fila, un
          // `SELECT` simple es seguro y suficiente para reportar cuántas filas serían afectadas.
          const [{ count }] = await this.sequelize.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM outbox_events
             WHERE status = 'pending'
               AND (_tenant_id = CAST(:tenantId AS BIGINT) OR _tenant_id IS NULL)
               AND COALESCE(available_at, now()) <= now()
               AND event_code NOT IN (:excludedCodes)`,
            { replacements: { tenantId: input.tenantId, excludedCodes }, type: QueryTypes.SELECT },
          );
          const backlog = await countOutboxBacklog(this.outboxModel, input.tenantId);
          const selected = Math.min(Number(count), input.body.limit);
          publishOutboxBacklog(this.metrics, input.tenantId, backlog);
          return {
            selected,
            processed: 0,
            // Misma población que `count` (inquilino + sin inquilino): si no, la resta puede ser negativa.
            skippedBusinessEvents: backlog.tenant + backlog.withoutTenant - Number(count),
            dryRun: true,
            note: 'process-outbox conserva compatibilidad y no procesa eventos de negocio registrados; usa process-events para notificaciones.',
          };
        }

        const now = new Date();
        const claimed = await this.sequelize.transaction(async (transaction) => {
          const rows = await this.sequelize.query<ClaimedOutboxRow>(
            `WITH candidates AS (
             SELECT _id
             FROM outbox_events
             WHERE status = 'pending'
               AND (_tenant_id = CAST(:tenantId AS BIGINT) OR _tenant_id IS NULL)
               AND COALESCE(available_at, now()) <= now()
               AND event_code NOT IN (:excludedCodes)
             ORDER BY COALESCE(available_at, now()) ASC, _id ASC
             LIMIT :limit
             FOR UPDATE SKIP LOCKED
           )
           UPDATE outbox_events AS event
           SET status = 'processed',
               attempts = COALESCE(event.attempts, 0) + 1,
               processed_at = :now,
               _updated_at = :now
           FROM candidates
           WHERE event._id = candidates._id
           RETURNING event._id AS id, event._tenant_id AS tenant_id, event.event_code, event.event_family;`,
            {
              replacements: { tenantId: input.tenantId, excludedCodes, limit: input.body.limit, now },
              type: QueryTypes.SELECT,
              transaction,
            },
          );
          return rows;
        });

        // B12: lo reclamado que es dominio sin registrar se marca procesado igual, pero deja aviso y métrica.
        const unregisteredDomainEvents = tallyUnregisteredDomainEvents(claimed);
        reportUnregisteredDomainEvents(this.logger, this.metrics, input.tenantId, unregisteredDomainEvents);

        // Fase 3.4: backlog restante tras drenar, en dos series para que el nulo no quede invisible.
        const after = await countOutboxBacklog(this.outboxModel, input.tenantId);
        publishOutboxBacklog(this.metrics, input.tenantId, after);

        return {
          selected: claimed.length,
          processed: claimed.length,
          // Atribución: lo ajeno aparte, para que el `result_json` de un inquilino no se lleve lo de nadie.
          processedWithoutTenant: claimed.filter((row) => row.tenant_id === null).length,
          skippedBusinessEvents: after.tenant,
          pendingWithoutTenant: after.withoutTenant,
          unregisteredDomainEvents,
          dryRun: false,
          note: 'process-outbox conserva compatibilidad y no procesa eventos de negocio registrados; usa process-events para notificaciones.',
        };
      },
    );
  }

  async processEvents(input: { tenantId: string; body: ProcessEventsDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'process_events', body: input.body, currentUser: input.currentUser },
      async () => {
        return this.eventsService.processPendingEvents({
          tenantId: input.tenantId,
          limit: input.body.limit,
          dryRun: input.body.dryRun,
          workerId: 'runtime_jobs_process_events',
        });
      },
    );
  }
}
