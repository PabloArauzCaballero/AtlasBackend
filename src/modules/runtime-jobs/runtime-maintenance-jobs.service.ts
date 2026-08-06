/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { IdempotencyKeyModel } from '../../database/models/index.js';
import { EventsService } from '../events/events.service.js';
import { NotificationOrchestratorService } from '../notifications/notification-orchestrator.service.js';
import { NotificationsRepository } from '../notifications/notifications.repository.js';
import { JobRunRecorderService } from './job-run-recorder.service.js';
import {
  DeliverPendingNotificationsDto,
  PurgeIdempotencyKeysDto,
  ReclaimStuckEventsDto,
  RetryStuckNotificationsDto,
} from './runtime-jobs.schemas.js';

/**
 * Trabajos de SANEAMIENTO de colas: no procesan dominio, recogen lo que el dominio deja atrás.
 *
 * Separados de `RuntimeJobsService` (outbox, eventos, sesiones, retención, calidad de datos) porque
 * responden a una pregunta distinta — no "¿qué hay que procesar?" sino "¿qué quedó sin procesar?" —
 * y porque `runtime-jobs.service.ts` ya estaba muy por encima del límite de tamaño: meterles 84
 * líneas más era justo lo que `yarn check:file-size` existe para impedir.
 *
 * Ambos cierran el resto del hallazgo A-03 de `docs/audit/auditoria-integral-2026-07-30.md`: dos
 * colas que crecían sin que nada las recogiera.
 */
@Injectable()
export class RuntimeMaintenanceJobsService {
  private readonly logger = new Logger(RuntimeMaintenanceJobsService.name);

  constructor(
    @InjectModel(IdempotencyKeyModel) private readonly idempotencyKeyModel: typeof IdempotencyKeyModel,
    private readonly notificationsRepository: NotificationsRepository,
    private readonly notificationOrchestrator: NotificationOrchestratorService,
    private readonly jobRuns: JobRunRecorderService,
    // Va AL FINAL a propósito, siguiendo el mismo criterio que `MetricsService` en
    // `RuntimeJobsService`: varias pruebas construyen este servicio posicionalmente, y una
    // dependencia nueva intercalada las rompería sin que nada del comportamiento haya cambiado.
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Rescata los eventos de dominio que quedaron bloqueados en `processing`.
   *
   * Es el mismo tipo de trabajo que `retryStuckNotifications` —recoger lo que el dominio dejó
   * atrás— pero una capa más abajo: allí se rescatan MENSAJES que nadie entregó, aquí EVENTOS que
   * nadie llegó a convertir en mensajes. Sin este barrido, un despliegue a mitad de una tanda de
   * `process_events` dejaba eventos reclamados que ninguna consulta volvía a mirar: la única cola
   * del sistema con pérdida permanente y silenciosa.
   *
   * La lógica de qué se considera varado y a dónde va cada evento vive en `EventsService`, que es
   * el dueño del ciclo de vida del outbox; aquí solo se le pone la envoltura de auditoría común a
   * todos los jobs para que la ejecución quede en `system_job_runs` como cualquier otra.
   */
  reclaimStuckEvents(input: { tenantId: string; body: ReclaimStuckEventsDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'reclaim_stuck_events', body: input.body, currentUser: input.currentUser },
      () =>
        this.eventsService.reclaimStuckEvents({
          tenantId: input.tenantId,
          olderThanMinutes: input.body.olderThanMinutes,
          limit: input.body.limit,
          dryRun: input.body.dryRun,
        }),
    );
  }

  /**
   * Reintenta los mensajes de notificación que quedaron en `pending`/`sending`.
   *
   * La entrega de un broadcast corre fuera del request (fire-and-forget), porque puede targetear
   * decenas de miles de destinatarios y hacerlo dentro del request lo haría durar minutos. La
   * contrapartida es que un reinicio a mitad de tanda dejaba mensajes creados que nadie volvía a
   * intentar.
   *
   * Se reintenta por el MISMO `deliverMessage` que la entrega normal, no por un camino paralelo: ese
   * método ya corta por sí solo si el mensaje llegó a un estado terminal, así que reintentar es
   * seguro incluso si otra instancia lo entregó entretanto, y un reintento no puede divergir del
   * camino feliz.
   *
   * Un mensaje que falla no cancela a los demás: se cuenta y se sigue. El resultado queda en
   * `system_job_runs`, que es donde se investiga qué destinatario se quedó sin aviso.
   */
  retryStuckNotifications(input: { tenantId: string; body: RetryStuckNotificationsDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'retry_stuck_notifications', body: input.body, currentUser: input.currentUser },
      async () => {
        const stuck = await this.notificationsRepository.listStuckMessages({
          tenantId: input.tenantId,
          olderThanMinutes: input.body.olderThanMinutes,
          limit: input.body.limit,
        });

        if (input.body.dryRun) return { selected: stuck.length, retried: 0, failed: 0, dryRun: true };

        let retried = 0;
        let failed = 0;
        for (const message of stuck) {
          try {
            await this.notificationOrchestrator.deliverMessage(message);
            retried += 1;
          } catch (error) {
            failed += 1;
            this.logger.warn(
              `No se pudo reintentar el mensaje ${String(message.id)}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return { selected: stuck.length, retried, failed, dryRun: false };
      },
    );
  }

  /**
   * Entrega los mensajes que el request dejó en `pending` a propósito.
   *
   * Con `NOTIFICATIONS_DELIVERY_MODE=deferred` el `POST` de broadcast sólo persiste los mensajes; la
   * entrega es trabajo de fondo y corre aquí. La diferencia con `retryStuckNotifications` no es
   * cosmética: aquel busca lo que quedó VARADO (mensajes viejos, cada 5 minutos) y este lo que está
   * RECIÉN creado (sin corte por antigüedad, cada 10 segundos). Un solo umbral no puede servir a los
   * dos casos.
   *
   * Ambos entregan por el mismo `deliverMessage`, que corta solo si el mensaje ya alcanzó un estado
   * terminal — por eso solaparse es seguro, y por eso un mensaje no se entrega dos veces aunque las
   * dos tandas lo seleccionen.
   */
  deliverPendingNotifications(input: { tenantId: string; body: DeliverPendingNotificationsDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'deliver_pending_notifications', body: input.body, currentUser: input.currentUser },
      async () => {
        const pending = await this.notificationsRepository.listStuckMessages({
          tenantId: input.tenantId,
          olderThanMinutes: 0,
          limit: input.body.limit,
        });

        if (input.body.dryRun) return { selected: pending.length, delivered: 0, failed: 0, dryRun: true };

        let delivered = 0;
        let failed = 0;
        for (const message of pending) {
          try {
            await this.notificationOrchestrator.deliverMessage(message);
            delivered += 1;
          } catch (error) {
            failed += 1;
            this.logger.warn(
              `No se pudo entregar el mensaje pendiente ${String(message.id)}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return { selected: pending.length, delivered, failed, dryRun: false };
      },
    );
  }

  /**
   * Purga las claves de idempotencia ya resueltas.
   *
   * `idempotency_keys` solo crecía — cada mutación con `X-Idempotency-Key` deja una fila y nada las
   * borraba nunca. En un backend con tráfico sostenido eso degrada los índices y, a la larga, el
   * propio `claimIdempotency` que protege cada comando.
   *
   * Solo se borran las `completed`/`failed`: una clave en `processing` puede pertenecer a una
   * petición en vuelo, y borrarla permitiría ejecutar el mismo comando dos veces. El borrado va
   * acotado por `limit` para no bloquear la tabla en una sola sentencia.
   */
  purgeIdempotencyKeys(input: { tenantId: string; body: PurgeIdempotencyKeysDto; currentUser: AuthenticatedUser }) {
    return this.jobRuns.run(
      { tenantId: input.tenantId, jobCode: 'purge_idempotency_keys', body: input.body, currentUser: input.currentUser },
      async () => {
        const cutoff = new Date(Date.now() - input.body.retentionDays * 24 * 60 * 60 * 1000);
        const where = {
          tenantScope: input.tenantId,
          status: { [Op.in]: ['completed', 'failed'] },
          updatedAtValue: { [Op.lt]: cutoff },
        };

        const selected = await this.idempotencyKeyModel.count({ where } as never);
        if (input.body.dryRun) return { selected, deleted: 0, cutoff: cutoff.toISOString(), dryRun: true };

        const deleted = await this.idempotencyKeyModel.destroy({ where, limit: input.body.limit } as never);
        return { selected, deleted, cutoff: cutoff.toISOString(), dryRun: false };
      },
    );
  }
}
