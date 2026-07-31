/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { WorkflowBundle } from './workflow-catalog.repository.js';

type Stage = WorkflowBundle['stages'][number];

/**
 * Orden de recorrido REAL de las etapas: el del árbol, no el de la columna `display_order`.
 *
 * `display_order` es relativo a los hermanos: una subetapa de captura de datos con orden 10 y la
 * primera etapa raíz con orden 10 son cosas distintas. Ordenar la lista plana por esa columna
 * intercala padres con hijos ajenos y produce un recorrido que no corresponde a ningún camino del
 * proceso — el cliente vería "verificar contacto" antes que "registrarse".
 *
 * La clave de orden es la cadena de `display_order` desde la raíz, que sí es un orden total
 * coherente con la jerarquía. Una etapa cuyo padre no está en el bundle (filtrado) se trata como
 * raíz, igual que hace el mapper del árbol.
 */
export function stagesInTreeOrder(stages: readonly Stage[]): Stage[] {
  const byId = new Map(stages.map((stage) => [String(stage.id), stage]));

  const sortKey = (stage: Stage): number[] => {
    const path: number[] = [];
    let current: Stage | undefined = stage;
    const guard = new Set<string>();
    while (current && !guard.has(String(current.id))) {
      guard.add(String(current.id));
      path.unshift(current.displayOrder);
      current = current.parentStageId === null ? undefined : byId.get(String(current.parentStageId));
    }
    return path;
  };

  return [...stages].sort((a, b) => comparePaths(sortKey(a), sortKey(b)));
}

/** Una etapa hoja no tiene subetapas: es donde ocurre el trabajo concreto del proceso. */
export function isLeafStage(stage: Stage, stages: readonly Stage[]): boolean {
  return !stages.some((candidate) => candidate.parentStageId !== null && String(candidate.parentStageId) === String(stage.id));
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    // Un prefijo va antes que su extensión: el padre se recorre antes que sus subetapas.
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left !== right) return left - right;
  }
  return 0;
}
