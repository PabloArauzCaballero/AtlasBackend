/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza define qué trabajos de fondo corren SÓLO donde se decidió encenderlos.
 * @system los trabajos condicionados por configuración, separados del catálogo incondicional.
 *
 * Se separan de `scheduled-jobs.catalog.ts` porque responden a una pregunta distinta: aquel declara
 * qué corre SIEMPRE, y éste qué corre sólo bajo una bandera. Mezclarlos hacía que cada trabajo
 * opcional nuevo metiera un `...(cond ? [] : [])` en medio de la lista, y la lista dejara de leerse
 * de un vistazo.
 */
import { env } from '../../config/env.js';
import { RuntimeMaintenanceJobsService } from './runtime-maintenance-jobs.service.js';
import { SCHEDULER_ACTOR, type ScheduledJob } from './scheduled-jobs.catalog.js';

export function buildOptionalJobs(deps: {
  maintenance: RuntimeMaintenanceJobsService;
  /** Consumidor de la cola de estrés: función desde la composición, no el servicio. */
  stressRuns: { drain: () => Promise<unknown> };
  /** Consumidor de las corridas QA: función desde la composición, no el servicio. */
  qaRuns: { drain: () => Promise<unknown> };
  limit: number;
}): ScheduledJob[] {
  const jobs: ScheduledJob[] = [];

  // Sólo tiene sentido cuando la API NO entrega dentro del request: si la entrega es `inline`,
  // este job competiría por los mismos mensajes que el proceso que acaba de crearlos.
  if (env.NOTIFICATIONS_DELIVERY_MODE === 'deferred') {
    jobs.push({
      jobCode: 'deliver_pending_notifications',
      intervalMs: env.RUNTIME_JOBS_NOTIFICATION_DELIVERY_INTERVAL_MS,
      run: (tenantId: string) =>
        deps.maintenance.deliverPendingNotifications({
          tenantId,
          body: { limit: deps.limit, dryRun: false },
          currentUser: SCHEDULER_ACTOR,
        }),
    });
  }

  /*
   * El job que convierte `queued: true` en tráfico.
   *
   * `SystemsStressRunService.queueStressRun` inserta una fila en `system_job_runs` con la nota
   * «la ejecución real debe hacerla un worker externo controlado». Ese worker no existía en ningún
   * repositorio: `systems_stress_run` aparecía sólo en el servicio que crea la fila, en su prueba
   * unitaria y en una semilla de demostración. Guardar un trabajo no es ejecutarlo, y una pantalla
   * que devuelve `queued: true` sobre una cola que nadie consume es peor que un botón desconectado,
   * porque parece que funcionó.
   *
   * Apagado por omisión porque genera tráfico HTTP real contra un objetivo registrado: se enciende
   * donde se decidió correr carga, no en todas partes.
   *
   * No recibe `tenantId`: la cola se reclama por `job_code` y cada fila lleva el suyo. Recorrer
   * tenants aquí reclamaría el mismo trabajo una vez por tenant.
   */
  if (env.RUNTIME_JOBS_STRESS_CONSUMER_ENABLED) {
    jobs.push({
      jobCode: 'consume_systems_stress_runs',
      intervalMs: env.RUNTIME_JOBS_STRESS_CONSUMER_INTERVAL_MS,
      run: () => deps.stressRuns.drain(),
    });
  }

  /*
   * El worker de las corridas QA de N personas. Mismo criterio que el de estrés: genera tráfico
   * HTTP real contra el backend QA de destino, así que se enciende sólo donde se decidió. Cada
   * vuelta late (readiness real que `capabilities` exige) y, si el proceso está libre, reclama una
   * corrida; la corrida se ejecuta FUERA de la tanda para no chocar con su tope de duración.
   */
  if (env.RUNTIME_JOBS_QA_CONSUMER_ENABLED) {
    jobs.push({
      jobCode: 'consume_qa_journey_runs',
      intervalMs: env.RUNTIME_JOBS_QA_CONSUMER_INTERVAL_MS,
      run: () => deps.qaRuns.drain(),
    });
  }

  return jobs;
}
