import { CUSTOMER_ID, getArrayFromPaths, getString, request } from './http.js';

const WORKFLOW_CODE = 'customer_credit_journey';

/**
 * Smoke del catálogo de flujos contra una API levantada.
 *
 * Verifica lo que ningún test unitario puede: que el árbol SEMBRADO existe en la base real, que el
 * grafo tiene nodos y aristas, que la validación de transición responde con el motivo correcto y —lo
 * más importante— que el informe de consistencia NO reporta errores contra las rutas realmente
 * montadas. Un `drift_detected` aquí significa que el proceso documentado dejó de corresponder al
 * backend desplegado, y el smoke falla en vez de dejarlo pasar en silencio.
 */
export async function runWorkflowCatalogSmoke(): Promise<void> {
  const list = await request({ method: 'GET', path: '/workflows', role: 'admin' });
  const workflows = getArrayFromPaths(list.data, [['data'], []]);
  if (!workflows.some((workflow) => workflow.workflowCode === WORKFLOW_CODE)) {
    throw new Error(`El flujo estándar ${WORKFLOW_CODE} no está sembrado: corre "yarn db:seed:prod".`);
  }

  await request({ method: 'GET', path: `/workflows/${WORKFLOW_CODE}/versions`, role: 'admin' });

  const tree = await request({ method: 'GET', path: `/workflows/${WORKFLOW_CODE}`, role: 'admin' });
  const stageCount = Number(getString(tree.data, ['data', 'totals', 'stages'], '0'));
  const stepCount = Number(getString(tree.data, ['data', 'totals', 'steps'], '0'));
  if (stageCount === 0 || stepCount === 0) throw new Error('El árbol sembrado no tiene etapas o pasos.');

  await request({ method: 'GET', path: `/workflows/${WORKFLOW_CODE}/stages`, role: 'admin' });
  await request({ method: 'GET', path: `/workflows/${WORKFLOW_CODE}/transitions`, role: 'admin' });

  const graph = await request({ method: 'GET', path: `/workflows/${WORKFLOW_CODE}/graph`, role: 'admin' });
  const nodes = getArrayFromPaths(graph.data, [['data', 'nodes']]);
  const edges = getArrayFromPaths(graph.data, [['data', 'edges']]);
  if (nodes.length === 0 || edges.length === 0) throw new Error('El grafo del flujo llegó sin nodos o sin aristas.');

  // Filtrado por módulo: debe devolver un subconjunto propio, no el árbol entero.
  const filtered = await request({ method: 'GET', path: `/workflows/${WORKFLOW_CODE}?moduleCode=credit`, role: 'admin' });
  const filteredSteps = Number(getString(filtered.data, ['data', 'totals', 'steps'], '0'));
  if (filteredSteps === 0 || filteredSteps >= stepCount) throw new Error('El filtro por módulo no recortó el árbol.');

  // Entrada declarada del flujo: sin paso de origen, `registration.start` debe ser transitable.
  const entry = await request({
    method: 'POST',
    path: `/workflows/${WORKFLOW_CODE}/transitions/validate`,
    role: 'admin',
    body: { toStepCode: 'registration.start' },
  });
  if (getString(entry.data, ['data', 'reasonCode'], '') !== 'TRANSITION_DECLARED') {
    throw new Error('La entrada declarada del flujo no fue aceptada.');
  }

  // Enviar el paquete sin haber completado ningún paso previo debe fallar por dependencias.
  const blocked = await request({
    method: 'POST',
    path: `/workflows/${WORKFLOW_CODE}/transitions/validate`,
    role: 'admin',
    body: { fromStepCode: 'consents.decisions', toStepCode: 'onboarding.submit' },
  });
  if (getString(blocked.data, ['data', 'reasonCode'], '') !== 'UNSATISFIED_DEPENDENCIES') {
    throw new Error('La validación no bloqueó una transición con dependencias obligatorias pendientes.');
  }

  await request({ method: 'GET', path: `/customers/${CUSTOMER_ID}/workflow-progress`, role: 'admin' });

  const consistency = await request({
    method: 'GET',
    path: `/operations/workflows/${WORKFLOW_CODE}/consistency`,
    role: 'platform_admin',
  });
  const issues = getArrayFromPaths(consistency.data, [['data', 'issues']]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`El árbol sembrado diverge de los endpoints expuestos: ${JSON.stringify(errors)}`);
  }
  console.log(`[OK] Consistencia del flujo: sin errores (${issues.length} avisos informativos).`);
}

if (process.argv[1]?.endsWith('workflow-catalog.smoke.ts') || process.argv[1]?.endsWith('workflow-catalog.smoke.js')) {
  void runWorkflowCatalogSmoke();
}
