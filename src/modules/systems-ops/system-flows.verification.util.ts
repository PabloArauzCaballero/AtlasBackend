/**
 * @file Utilidad de dominio: decide la verificación y la frescura de un flujo sin mirar la base.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system cruza el resumen de `system_action_logs` con el catálogo y compara el commit analizado con el desplegado.
 */

/** Resumen de las corridas de una ruta en la ventana consultada, tal como lo devuelve el repositorio. */
export type RouteRuns = {
  ok: number;
  failed: number;
  lastAt: Date | null;
  lastStatus: number | null;
  statuses: Record<string, number>;
  correlationSample: string[];
};

export type VerificationOutcome = {
  verification: 'UNVERIFIED' | 'VERIFIED' | 'BROKEN';
  evidence: Record<string, unknown>;
};

/**
 * VERIFIED cuando al menos una corrida real respondió sin error de servidor (< 500): el guard, el
 * controller y el service se ejecutaron de verdad. BROKEN cuando sólo hubo 5xx en la ventana: la
 * ruta existe pero no llega al final. Un 401/403/404 cuenta como corrida válida — el flujo hizo
 * lo que debía con esa entrada — y queda registrado en `statuses` para quien quiera mirarlo.
 * Sin corridas no se toca nada: no verificado no es lo mismo que roto.
 */
export function verificationFromRuns(runs: RouteRuns | null, source: string): VerificationOutcome | null {
  if (!runs || (!runs.ok && !runs.failed)) return null;
  const evidence = {
    source,
    ok: runs.ok,
    failed: runs.failed,
    lastAt: runs.lastAt?.toISOString() ?? null,
    lastStatus: runs.lastStatus,
    statuses: runs.statuses,
    correlationSample: runs.correlationSample.slice(0, 5),
  };
  return { verification: runs.ok > 0 ? 'VERIFIED' : 'BROKEN', evidence };
}

/**
 * La plantilla de ruta del log (`/api/v1/systems/flows/:flowId`) al formato del catálogo
 * (`systems/flows/:p`): sin prefijo global y con todo parámetro como `:p`.
 */
export function catalogPathFromRouteTemplate(routeTemplate: string): string {
  return routeTemplate
    .replace(/^\/?(api\/v1|api|v1)\//, '')
    .replace(/^\//, '')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':p')
    .replace(/\/$/, '');
}

/** FRESH si el commit analizado es el desplegado; STALE si difieren; sin commit desplegado no se opina. */
export function freshnessFor(analyzedCommit: string | null, deployedCommit: string | null | undefined): 'FRESH' | 'STALE' | null {
  // `APP_COMMIT_SHA=local` (o cualquier valor que no sea un sha) no es un commit: no se compara, no se opina.
  if (!deployedCommit || !analyzedCommit || !/^[0-9a-f]{7,40}$/i.test(deployedCommit)) return null;
  return analyzedCommit.startsWith(deployedCommit) || deployedCommit.startsWith(analyzedCommit) ? 'FRESH' : 'STALE';
}
