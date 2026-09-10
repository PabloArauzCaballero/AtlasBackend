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

/**
 * Una fila del resumen de accesos de otro bloque, tal como la federa (`GET /v1/audit/access-runs`).
 * `resource` es "MÉTODO Clase.handler" y `decision` es ALLOW/DENY del handler, no un código HTTP.
 */
export type BlockAccessRun = {
  resource: string;
  decision: string;
  /** Código HTTP con el que acabó. Nulo en las filas que el Motor guardó antes de anotarlo. */
  status?: number | null;
  count: number;
  lastAt: string | Date | null;
};

/**
 * Índice por `MÉTODO Controller.handler`, que es como el bloque identifica sus accesos. El catálogo
 * de Flujos guarda controller y handler por separado, así que la clave se arma igual en los dos
 * lados y el cruce no depende de la ruta —que el interceptor del Motor no registra—.
 */
export function indexBlockRuns(rows: readonly BlockAccessRun[]): Map<string, RouteRuns> {
  const out = new Map<string, RouteRuns>();
  for (const row of rows) {
    const previo = out.get(row.resource) ?? { ok: 0, failed: 0, lastAt: null, lastStatus: null, statuses: {}, correlationSample: [] };
    // ALLOW = el handler terminó; DENY = lanzó, y lanzar cubre desde un 400 de validación hasta un
    // 500 de verdad. Sólo el 5xx es un fallo: contar todo DENY como fallo marcaba BROKEN flujos que
    // hacían su trabajo (medido: un «Version is not fully approved» rompía el despliegue de
    // versiones). Un DENY SIN código es de antes de que el Motor lo guardara: no se puede afirmar
    // que reventó, así que cuenta como corrida y se deja el DENY a la vista en la evidencia.
    const esFallo = (row.status ?? 0) >= 500;
    previo[esFallo ? 'failed' : 'ok'] += row.count;
    const etiqueta = row.status ? `${row.decision} ${row.status}` : row.decision;
    previo.statuses[etiqueta] = (previo.statuses[etiqueta] ?? 0) + row.count;
    if (row.status) previo.lastStatus = row.status;
    const fecha = row.lastAt ? new Date(row.lastAt) : null;
    if (fecha && (!previo.lastAt || fecha > previo.lastAt)) previo.lastAt = fecha;
    out.set(row.resource, previo);
  }
  return out;
}

/** Una entrada del recuento que publica el ERP: método, plantilla de ruta y estados HTTP reales. */
export type BlockPathRun = {
  method: string;
  path: string;
  ok: number;
  failed: number;
  lastStatus: number;
  lastAt: string | null;
  statuses: Record<string, number>;
};

/**
 * Índice por `MÉTODO ruta`, normalizando la ruta al formato del catálogo. El ERP sí registra ruta y
 * código HTTP, así que su cruce es el mismo que el del Backend y no hace falta traducir nada.
 */
export function indexBlockPathRuns(rows: readonly BlockPathRun[]): Map<string, RouteRuns> {
  const out = new Map<string, RouteRuns>();
  for (const row of rows) {
    const clave = `${row.method} ${catalogPathFromRouteTemplate(row.path)}`;
    const previo = out.get(clave) ?? { ok: 0, failed: 0, lastAt: null, lastStatus: null, statuses: {}, correlationSample: [] };
    previo.ok += row.ok;
    previo.failed += row.failed;
    previo.lastStatus = row.lastStatus ?? previo.lastStatus;
    for (const [estado, veces] of Object.entries(row.statuses ?? {})) previo.statuses[estado] = (previo.statuses[estado] ?? 0) + veces;
    const fecha = row.lastAt ? new Date(row.lastAt) : null;
    if (fecha && (!previo.lastAt || fecha > previo.lastAt)) previo.lastAt = fecha;
    out.set(clave, previo);
  }
  return out;
}

/** FRESH si el commit analizado es el desplegado; STALE si difieren; sin commit desplegado no se opina. */
export function freshnessFor(analyzedCommit: string | null, deployedCommit: string | null | undefined): 'FRESH' | 'STALE' | null {
  // `APP_COMMIT_SHA=local` (o cualquier valor que no sea un sha) no es un commit: no se compara, no se opina.
  if (!deployedCommit || !analyzedCommit || !/^[0-9a-f]{7,40}$/i.test(deployedCommit)) return null;
  return analyzedCommit.startsWith(deployedCommit) || deployedCommit.startsWith(analyzedCommit) ? 'FRESH' : 'STALE';
}
