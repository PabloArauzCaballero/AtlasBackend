/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Define el trabajo de fondo que pide al Motor su opinión sobre las solicitudes del titular.
 * @system declara el trabajo programado de privacidad, aparte del catálogo general.
 */
import { env } from '../../config/env.js';
import type { ScheduledJob } from './scheduled-jobs.catalog.js';

/**
 * Trabajos de fondo de PRIVACIDAD. En su propio archivo por la misma razón que los de crédito: el catálogo general está
 * en el tope de `check:file-size`.
 */
export function buildPrivacyScheduledJobs(deps: {
  /** Llega estructural desde la composición para no importar internos de privacidad (`check:architecture`). */
  privacyDecisions: { sweepShadow: (input: { tenantId: string; limit: number }) => Promise<unknown> };
}): ScheduledJob[] {
  return [
    /*
     * El Motor opina, en sombra, sobre las solicitudes de corregir o borrar abiertas. No cambia su estado: la persona las
     * cierra igual, viendo lo que opinó. Sin artefacto de privacidad asignado, la pasada no lee nada.
     */
    {
      jobCode: 'decide_privacy_requests_shadow',
      intervalMs: env.RUNTIME_JOBS_PRIVACY_SHADOW_INTERVAL_MS,
      run: (tenantId) => deps.privacyDecisions.sweepShadow({ tenantId, limit: env.RUNTIME_JOBS_PRIVACY_SHADOW_LIMIT }),
    },
  ];
}
