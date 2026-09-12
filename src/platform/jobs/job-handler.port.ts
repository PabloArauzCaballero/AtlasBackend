/**
 * @file Puerto de manejador de trabajos programados (AT-038).
 * @business Un job tiene identidad, versión y una ejecución idempotente por tenant; el planificador sólo
 *   conoce descriptores y leases, no los repositorios de cada módulo.
 * @system Interfaz + token de colección. Los manejadores los registra cada módulo propietario en su
 *   composición; el planificador los recoge por el token.
 */
export type JobDescriptor = Readonly<{
  jobCode: string;
  version: number;
  intervalMs: number;
  /** `singleton`: una sola ejecución en toda la flota por tanda (lease). `per_instance`: cada proceso. */
  concurrency: 'singleton' | 'per_instance';
  /** Tiempo máximo de una tanda; pasado, el lease vence y otro worker puede reclamar. */
  deadlineMs: number;
}>;

export interface JobHandler {
  readonly descriptor: JobDescriptor;
  /** Idempotente: repetir la tanda sobre el mismo tenant no duplica efectos. */
  run(tenantId: string, signal: AbortSignal): Promise<Record<string, unknown>>;
}

export const JOB_HANDLERS = 'atlas.platform.job-handlers';
