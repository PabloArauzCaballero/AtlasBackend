/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Define los trabajos de fondo del crédito que corren solos y con qué frecuencia.
 * @system declara los trabajos programados de crédito, aparte del catálogo general.
 */
import { env } from '../../config/env.js';
import type { ScheduledJob } from './scheduled-jobs.catalog.js';

/**
 * Trabajos de fondo del CRÉDITO.
 *
 * Van en su propio archivo y no en `scheduled-jobs.catalog.ts` porque ése ya está en el tope del
 * gate de tamaño (`check:file-size`): un trabajo más lo habría hecho crecer por encima del piso del
 * baseline. La cadencia sigue siendo declarativa y el planificador los recibe en la misma lista
 * (ver la composición en `runtime-jobs.module.ts`).
 */
export function buildCreditScheduledJobs(deps: {
  /** Llega estructural desde la composición para no importar internos de crédito (`check:architecture`). */
  creditReconciliation: { reconcile: (input: { tenantId: string; graceMinutes: number; limit: number }) => Promise<unknown> };
}): ScheduledJob[] {
  return [
    /*
     * Solicitudes que se quedaron en `submitted` (C-2).
     *
     * El submit confirma la solicitud y luego pregunta al motor; si el proceso muere en medio, la
     * fila queda sin decidir y bloquea al cliente para siempre por el índice único de solicitud
     * abierta. Este barrido las vuelve a decidir por el mismo camino, pasado el plazo de gracia.
     */
    {
      jobCode: 'reconcile_submitted_credit_applications',
      intervalMs: env.RUNTIME_JOBS_CREDIT_RECONCILE_INTERVAL_MS,
      run: (tenantId) =>
        deps.creditReconciliation.reconcile({
          tenantId,
          graceMinutes: env.RUNTIME_JOBS_CREDIT_SUBMITTED_GRACE_MINUTES,
          limit: env.RUNTIME_JOBS_CREDIT_RECONCILE_LIMIT,
        }),
    },
  ];
}
