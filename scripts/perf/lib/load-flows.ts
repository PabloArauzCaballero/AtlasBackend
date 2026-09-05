/**
 * Mezcla de tráfico de las pruebas de carga.
 *
 * Todas las rutas de aquí están verificadas contra controladores reales del repositorio (la
 * referencia queda anotada en cada flujo). Golpear un endpoint inventado produce un 404 rapidísimo
 * y un p95 excelente que no mide absolutamente nada.
 *
 * La mezcla es deliberadamente de LECTURA. Una prueba de carga que escribe contra un entorno
 * compartido deja datos que contaminan la siguiente corrida y hace que el baseline se degrade solo,
 * por acumulación, sin que nadie haya tocado el código. Las escrituras se prueban aparte, con
 * `yarn stress:notifications`, que sí verifica su propio rastro por `correlationId` y lo comprueba.
 */

export type LoadFlow = {
  name: string;
  method: 'GET';
  /** Ruta relativa al prefijo de la API (`API_PREFIX`), sin barra inicial duplicada. */
  path: string;
  /** Rol con el que se firma el token. `null` = endpoint público, sin cabecera Authorization. */
  role: 'admin' | 'customer' | 'system' | null;
  /** Peso relativo en la mezcla. Aproxima la frecuencia real, no reparte por igual. */
  weight: number;
  /** Códigos aceptables. Todo lo demás cuenta como error de la corrida. */
  expect: number[];
  /** Por qué este flujo está en la mezcla y qué parte del sistema ejercita. */
  rationale: string;
};

/**
 * `readonly` a propósito: la mezcla es el contrato del baseline. Cambiarla invalida cualquier
 * comparación antes/después, así que debe ser un cambio consciente en el archivo y documentado en
 * `docs/performance/backend/01-baseline.md`, no una mutación en tiempo de ejecución.
 */
export const READ_FLOWS: readonly LoadFlow[] = [
  {
    name: 'health',
    method: 'GET',
    path: '/health',
    role: null,
    weight: 1,
    expect: [200, 503],
    rationale:
      'Piso de latencia del transporte: mide middleware, helmet, compresión y serialización sin tocar la base. Si este flujo se degrada, el cuello NO está en las queries. Ver src/modules/health/health.controller.ts:99.',
  },
  {
    name: 'catalogos-listado',
    method: 'GET',
    path: '/operations/catalogs?page=1&limit=20',
    role: 'admin',
    weight: 4,
    expect: [200],
    rationale:
      'Listado paginado autenticado: ejercita guard JWT + TenantGuard + repositorio + mapeo a DTO. Es la forma dominante de lectura del portal. Ver src/modules/catalog-management/catalog-management.controller.ts:92.',
  },
  {
    name: 'definiciones',
    method: 'GET',
    path: '/operations/definitions',
    role: 'admin',
    weight: 2,
    expect: [200],
    rationale:
      'Lectura de datos de configuración, candidata natural a caché: sirve para comprobar si el hit ratio mejora la latencia o si el coste estaba en otro sitio. Ver src/modules/catalog-management/catalog-management.controller.ts:249.',
  },
  {
    name: 'politica-riesgo-vigente',
    method: 'GET',
    path: '/operations/risk-policy/current',
    role: 'admin',
    weight: 2,
    expect: [200, 404],
    rationale:
      'Lectura de un único registro vigente: aísla el coste de resolver "la versión actual" frente al de paginar. 404 es válido si el tenant no tiene política publicada. Ver src/modules/catalog-management/catalog-management.controller.ts:280.',
  },
  {
    name: 'eventos-operaciones',
    method: 'GET',
    path: '/operations/events?page=1&limit=20',
    role: 'admin',
    weight: 3,
    expect: [200],
    rationale:
      'Listado sobre la tabla de outbox, que crece de forma monótona: es donde primero aparece un índice que falta o un conteo caro. Ruta verificada en scripts/stress/notifications.stress.ts:307.',
  },
  {
    name: 'glosario-negocio',
    method: 'GET',
    path: '/internal/business-metadata/glossary',
    role: 'admin',
    weight: 1,
    expect: [200],
    rationale:
      'Lectura del portal interno con su propia cadena de autorización RBAC. Ver src/modules/internal-portal/internal-portal.controller.ts:62.',
  },
];

/** Selección ponderada determinista por índice de petición: misma mezcla en cada corrida, sin RNG. */
export function pickFlow(flows: readonly LoadFlow[], requestIndex: number): LoadFlow {
  const total = flows.reduce((sum, flow) => sum + flow.weight, 0);
  let cursor = requestIndex % total;
  for (const flow of flows) {
    if (cursor < flow.weight) return flow;
    cursor -= flow.weight;
  }
  return flows[0];
}
