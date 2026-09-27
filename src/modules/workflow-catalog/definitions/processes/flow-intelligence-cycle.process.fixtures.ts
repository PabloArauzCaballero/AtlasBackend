/**
 * @file Proceso declarado en código: Flujos: derivar → analizar → comprobar → cargar → verificar → compuerta → revisión humana.
 * @business El mapa de flujos dice qué ruta usa cada pantalla, qué tablas toca y si se ha visto funcionar de verdad; este ciclo lo mantiene al día y hace que una persona firme lo que la máquina no pudo resolver.
 * @system fixture P-31 que `syncWorkflowCatalog` vuelca a `workflow_*`; derivación en el repo AtlasFlowIntelligence (Actions) y carga/verificación/revisión en `systems-ops` (`system-flows*.controller.ts`).
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** `SYSTEMS_OPS_FINE_PERMISSION_ROLES`: roles de sesión que llegan a Flujos; decide el permiso fino. */
const FLOWS_SESSION = [
  'system_admin',
  'platform_admin',
  'admin',
  'qa_engineer',
  'devops',
  'risk_analyst',
  'compliance_analyst',
  'readonly_auditor',
  'internal_operator',
];
/** `SYSTEMS_OPS_GOVERNANCE_ROLES`, que manda sobre la clase en las cargas (permiso `systems.flows.analyze`). */
const GOVERNANCE = ['system_admin', 'platform_admin', 'admin'];

export const FLOW_INTELLIGENCE_CYCLE: WorkflowDefinitionFixture = {
  processId: 'P-31',
  code: 'flow_intelligence_cycle',
  version: 'v1',
  name: 'Flujos: derivar → analizar → comprobar → cargar → verificar → compuerta → revisión humana',
  description:
    'El ciclo de Flow Intelligence: el repositorio AtlasFlowIntelligence deriva el inventario federado de rutas y pantallas, lo analiza con el compilador, lo compara con la línea base; el cargador lo sube al catálogo de flujos, se verifica contra el tráfico real, la compuerta de documentación dice qué falta mirar y una persona revisa los flujos críticos inciertos.',
  processType: 'system_job',
  ownerDomain: 'platform',
  ownerRole: 'SYSTEMS_ADMIN',
  priority: 'P2',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Nadie sabía qué pantalla llama a qué ruta, qué tablas escribe ni si se había visto funcionar: el mapa de flujos une los catálogos que ya existían con las pantallas de los cinco clientes y hace ruidosa la deriva (llamadas a rutas inexistentes, escrituras públicas, menús sin permiso).',
    whoStartsAndCloses:
      'Lo inicia el sistema: un push a dev o el cron 06:17 en GitHub Actions del repo AtlasFlowIntelligence. La carga la lanza un administrador de sistemas con load.mjs y su sesión con PIN; lo cierra la persona de gobierno (permiso systems.flows.review) que firma los flujos críticos en la cola de revisión.',
    startAndEnd:
      'Empieza con derive.mjs sobre los repos en dev y termina con el artefacto cargado (declaredCount igual al del manifiesto y artifact_generated_at no anterior al último), la verificación hecha y FLOW_DOCUMENTATION_GATE en verde; los flujos CRITICAL/HIGH inciertos quedan APPROVED o REJECTED.',
    whenItFails:
      'El gate de Actions falla sólo por hallazgos nuevos respecto a la línea base; sin el secret ATLAS_REPOS_TOKEN corre con los repos públicos y lo avisa. Una carga truncada o vieja la rechaza el servidor. Hoy el gate está en rojo desde el 2026-09-21 por seis llamadas sin ruta y el 26-09 no arrancó por facturación de GitHub.',
    healthIndicator:
      'Compuerta de documentación en verde, flujos VERIFIED frente a BROKEN (107 de 112 en la primera verificación), frescura FRESH frente a STALE, y cola de revisión vacía; lo ve el administrador en «Flujos» y «Compuerta».',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'platform_ops',
    table: 'system_flow_catalog',
    idColumn: '_id',
    statusColumn: 'review_status',
    labelColumn: 'flow_id',
    openStatuses: ['NEEDS_REVIEW'],
  },
  success:
    'El artefacto vigente está cargado, verificado contra tráfico real, la compuerta pasa y los flujos críticos inciertos están firmados.',
  failure: 'El gate queda en rojo, la carga se rechaza o el catálogo de flujos se queda viejo sin que la compuerta lo diga.',
  sources: [
    '/private/tmp/fi-root-20260926/AtlasFlowIntelligence/.github/workflows/flow-consistency-check.yml',
    '/private/tmp/fi-root-20260926/AtlasFlowIntelligence/tools/README.md',
    'src/modules/systems-ops/system-flows.controller.ts',
    'src/modules/systems-ops/system-flows-review.controller.ts',
    'src/modules/systems-ops/systems-ops.constants.ts',
    'memoria atlas-flow-intelligence-ya-existe',
    'memoria atlas-flujos-revision-humana',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-31)',
  ],
  stages: [
    {
      code: 'flows_derive_and_check',
      name: 'Derivar, analizar y comprobar',
      description:
        'FLOW_CONSISTENCY_CHECK clona los repos en dev, regenera el artefacto, lo analiza con el compilador y lo compara con flow-model/baseline.json.',
      module: 'flow_intelligence',
      actor: 'system',
      client: 'BLOCK',
      entry: true,
      steps: [
        {
          code: 'flows.derive',
          name: 'Derivar el inventario federado',
          description:
            'derive.mjs escribe rutas, tablas, contratos, pantallas y llamadas de cada cliente, con su manifiesto y contentHash.',
          kind: 'external',
          reason: 'Corre en GitHub Actions del repo AtlasFlowIntelligence (push a dev o cron 17 6 * * *), fuera de cualquier bloque.',
        },
        {
          code: 'flows.analyze',
          name: 'Analizar handler → servicio → tabla',
          description: 'analyze.mjs resuelve con el Program de TypeScript qué tablas lee y escribe cada ruta.',
          kind: 'external',
          reason: 'Paso del mismo workflow de Actions; no llama a ningún bloque ni escribe en ninguna base.',
        },
        {
          code: 'flows.consistency_check',
          name: 'Comparar con la línea base',
          description: 'consistency-check.mjs falla sólo por hallazgos nuevos; STALE se lista y no bloquea.',
          kind: 'external',
          reason: 'Es el gate de Actions del repo AtlasFlowIntelligence; su salida es un artifact del run, no una llamada.',
          errors: ['CLIENT_CALL_UNMATCHED', 'UNPROTECTED_WRITE', 'CONTRACT_DRIFT'],
        },
      ],
    },
    {
      code: 'flows_load',
      name: 'Cargar el artefacto',
      description:
        'load.mjs lee primero el contrato de carga y sube rutas, pantallas y hallazgos por bloque, con declaredCount y la fecha del artefacto. Lo ejecuta un administrador con su sesión y PIN.',
      module: 'systems_ops',
      actor: 'system',
      client: 'BLOCK',
      roles: GOVERNANCE,
      steps: [
        {
          code: 'flows.import_contract',
          name: 'Leer el contrato de carga',
          description: 'Sin él, un servidor viejo aceptaría las cargas y zod quitaría declaredCount sin decir nada.',
          method: 'GET',
          path: '/systems/flows/import/contract',
          roles: FLOWS_SESSION,
        },
        {
          code: 'flows.import_endpoints',
          name: 'Cargar flujos (rutas)',
          description: 'Reemplaza los flujos del bloque; rechaza otra cifra que declaredCount y artefactos anteriores al último cargado.',
          method: 'POST',
          path: '/systems/flows/import/endpoints',
          roles: GOVERNANCE,
          resultingStates: ['NEEDS_REVIEW'],
          errors: ['409 artefacto anterior al último cargado', '400 declaredCount no coincide'],
        },
        {
          code: 'flows.import_screens',
          name: 'Cargar pantallas',
          description: 'Carga las pantallas de cada cliente; rechaza quitar puertas de menú ruta a ruta salvo allowRemovingMenuGates.',
          method: 'POST',
          path: '/systems/flows/import/screens',
          roles: GOVERNANCE,
        },
        {
          code: 'flows.import_findings',
          name: 'Cargar hallazgos',
          description: 'Un hallazgo resolved que reaparece vuelve a open; acknowledged y false_positive no se tocan.',
          method: 'POST',
          path: '/systems/flows/import/findings',
          roles: GOVERNANCE,
        },
        {
          code: 'flows.imports_history',
          name: 'Historial de cargas',
          description: 'Cargas por bloque y alcance, para saber qué artefacto está vigente.',
          method: 'GET',
          path: '/systems/flows/imports',
          roles: FLOWS_SESSION,
          optional: true,
        },
      ],
    },
    {
      code: 'flows_verify',
      name: 'Verificar contra tráfico real',
      description: 'Cruza los flujos con system_action_logs de los últimos 30 días: método, ruta y código HTTP.',
      module: 'systems_ops',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'flows.verify',
          name: 'Verificar flujos',
          description: 'Marca VERIFIED o BROKEN cada flujo con tráfico observado.',
          method: 'POST',
          path: '/systems/flows/verify',
          roles: GOVERNANCE,
          resultingStates: ['VERIFIED', 'BROKEN'],
        },
      ],
    },
    {
      code: 'flows_gate',
      name: 'Compuerta de documentación',
      description:
        'El administrador mira qué no se ha podido comprobar: hallazgos sin cargar, deriva cortada, menús sin permiso y trabajo pendiente.',
      module: 'systems_ops',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/flows/gate',
      steps: [
        {
          code: 'flows.documentation_gate',
          name: 'Leer la compuerta',
          description: 'FLOW_DOCUMENTATION_GATE: falla sobre lo que no se ha podido mirar.',
          method: 'GET',
          path: '/systems/flows/documentation-gate',
          roles: FLOWS_SESSION,
        },
        {
          code: 'flows.rbac_drift',
          name: 'Ver la deriva de permisos del menú',
          description: 'Pantallas cuyo menú no filtra por el mismo permiso que la ruta que llama.',
          method: 'GET',
          path: '/systems/flows/rbac-drift',
          roles: FLOWS_SESSION,
          optional: true,
        },
        {
          code: 'flows.pending_work',
          name: 'Ver el trabajo pendiente',
          description: 'Incluye los eventos de dominio sin aviso por código.',
          method: 'GET',
          path: '/systems/flows/pending-work',
          roles: FLOWS_SESSION,
          optional: true,
        },
        {
          code: 'flows.business',
          name: 'Ver procesos de negocio contra el catálogo',
          description: 'Cruza workflow_definitions y sus pasos con el catálogo de flujos por método y ruta.',
          method: 'GET',
          path: '/systems/flows/business',
          roles: FLOWS_SESSION,
          optional: true,
        },
      ],
    },
    {
      code: 'flows_human_review',
      name: 'Revisión humana de flujos',
      description:
        'La persona con systems.flows.review firma los flujos CRITICAL/HIGH con análisis incierto; decidir exige la huella de dependencias que traía la cola.',
      module: 'systems_ops',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/flows/review',
      terminal: true,
      requiredStates: ['NEEDS_REVIEW'],
      resultingStates: ['APPROVED', 'REJECTED'],
      steps: [
        {
          code: 'flows.review_queue',
          name: 'Leer la cola de revisión',
          description: 'Flujos en NEEDS_REVIEW con su huella de dependencias.',
          method: 'GET',
          path: '/systems/flows/review-queue',
          roles: FLOWS_SESSION,
        },
        {
          code: 'flows.review',
          name: 'Firmar un flujo',
          description:
            'Aprueba o rechaza; 409 si el código cambió desde que se leyó la cola. Si vuelve a cambiar, el flujo regresa a la cola.',
          method: 'PATCH',
          path: '/systems/flows/:flowId/review',
          roles: FLOWS_SESSION,
          resultingStates: ['APPROVED', 'REJECTED'],
          errors: ['409 huella de dependencias cambiada'],
        },
      ],
    },
  ],
  metadata: {
    gaps: [
      'Gate en rojo desde 2026-09-21 (6 CLIENT_CALL_UNMATCHED de qa-lab/mock-provider-endpoints.ts); el 26-09 no arrancó por facturación de GitHub.',
      'No hay ruta para marcar hallazgos acknowledged/false_positive: sólo SQL.',
      'La carga (load.mjs) no tiene pantalla ni job: la ejecuta una persona con PIN.',
    ],
  },
};
