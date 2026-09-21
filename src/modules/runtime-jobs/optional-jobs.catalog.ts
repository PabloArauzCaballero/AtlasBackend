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

  return jobs;
}
