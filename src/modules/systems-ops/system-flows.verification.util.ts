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
  /** Fecha de la corrida más reciente. Decide si la evidencia ejercitó el código de HOY. */
  lastAt: Date | null;
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
  // `lastAt` viaja también fuera de la evidencia: quien decide la frescura necesita compararla
  // con la fecha del último cambio de código, y hurgar dentro del JSON para eso sería peor.
  return { verification: runs.ok > 0 ? 'VERIFIED' : 'BROKEN', evidence, lastAt: runs.lastAt };
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

/** Lo que se observó desde una pantalla en la ventana: cuánto, cómo acabó y contra qué rutas. */
export type ScreenRuns = {
  calls: number;
  failed: number;
  lastAt: Date | null;
  routes: Array<{ method: string; path: string; calls: number; failed: number }>;
};

/**
 * Reparte lo observado —rutas CONCRETAS, tal como el cliente las declaró— entre las plantillas del
 * catálogo de pantallas.
 *
 * ## Por qué se resuelve aquí y no en el cliente
 *
 * Porque aquí están las plantillas. El portal no sabe qué segmento de `/internal/customers/internal`
 * es un identificador sin adivinar, y adivinar produce plantillas que no existen: sustituyendo el
 * valor del parámetro por su nombre, un id que coincide con un segmento estático se come el prefijo.
 *
 * ## Qué gana la más específica
 *
 * Una ruta concreta puede encajar en dos plantillas —`/internal/customers/new` encaja también en
 * `/internal/customers/:id`—. Gana la literal exacta; si no hay, la de MENOS parámetros, y a igualdad
 * la de prefijo estático más largo. Sin esa regla, una pantalla de alta se contaría como visita a la
 * ficha de un cliente que no existe.
 *
 * Lo que no encaja en ninguna plantilla se devuelve aparte: es una pantalla que alguien usó y el
 * catálogo no conoce —o una ruta que dejó de existir— y esconderlo sería perder justo el hallazgo.
 */
export function matchScreenRuns(
  observado: Map<string, ScreenRuns>,
  plantillas: readonly string[],
): { porPlantilla: Map<string, ScreenRuns>; sinCatalogar: string[] } {
  const literales = new Set(plantillas.filter((ruta) => !ruta.includes(':')));
  const conParametros = plantillas
    .filter((ruta) => ruta.includes(':'))
    .map((ruta) => ({
      ruta,
      params: (ruta.match(/:[^/]+/g) ?? []).length,
      prefijo: ruta.split('/:')[0]?.length ?? 0,
      regex: new RegExp(`^${ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+')}$`),
    }))
    .sort((a, b) => a.params - b.params || b.prefijo - a.prefijo);

  const porPlantilla = new Map<string, ScreenRuns>();
  const sinCatalogar: string[] = [];
  for (const [concreta, runs] of observado) {
    const plantilla = literales.has(concreta) ? concreta : conParametros.find((candidata) => candidata.regex.test(concreta))?.ruta;
    if (!plantilla) {
      sinCatalogar.push(concreta);
      continue;
    }
    const previo = porPlantilla.get(plantilla);
    porPlantilla.set(plantilla, previo ? fundir(previo, runs) : { ...runs, routes: [...runs.routes] });
  }
  return { porPlantilla, sinCatalogar };
}

/** Dos visitas a la misma plantilla con identificadores distintos son la MISMA pantalla. */
function fundir(a: ScreenRuns, b: ScreenRuns): ScreenRuns {
  const porRuta = new Map<string, { method: string; path: string; calls: number; failed: number }>();
  for (const llamada of [...a.routes, ...b.routes]) {
    const clave = `${llamada.method} ${llamada.path}`;
    const previa = porRuta.get(clave);
    porRuta.set(
      clave,
      previa ? { ...previa, calls: previa.calls + llamada.calls, failed: previa.failed + llamada.failed } : { ...llamada },
    );
  }
  return {
    calls: a.calls + b.calls,
    failed: a.failed + b.failed,
    lastAt: !a.lastAt ? b.lastAt : !b.lastAt ? a.lastAt : a.lastAt > b.lastAt ? a.lastAt : b.lastAt,
    routes: [...porRuta.values()].sort((x, y) => y.calls - x.calls),
  };
}

/**
 * El desenlace de una pantalla. Deliberadamente sólo hay dos: **usada o no usada**.
 *
 * No existe un BROKEN de pantalla, y la tentación de inventarlo con «tiene llamadas fallidas» sería
 * un error de categoría: lo que falla es el endpoint, y ése ya tiene su propio eje y su propia
 * ficha. Una pantalla que llama a algo roto no está rota —hace su trabajo y enseña el error—, y
 * marcarla en rojo duplicaría el mismo hallazgo en dos sitios con dos dueños distintos.
 *
 * Lo que sí se guarda es el detalle observado, porque responde la pregunta que ningún análisis
 * estático puede: contra qué rutas llama DE VERDAD esta pantalla.
 */
export function screenVerificationFrom(
  runs: ScreenRuns | null,
  source = 'system_action_logs (origin_screen)',
): {
  verification: string;
  lastSeenAt: Date | null;
  observed: Record<string, unknown>;
} | null {
  if (!runs || runs.calls === 0) return null;
  return {
    verification: 'VERIFIED',
    lastSeenAt: runs.lastAt,
    observed: {
      source,
      calls: runs.calls,
      failed: runs.failed,
      routes: runs.routes.slice(0, 40),
    },
  };
}
