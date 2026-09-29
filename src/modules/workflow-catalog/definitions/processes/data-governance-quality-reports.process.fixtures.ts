/**
 * @file Proceso declarado en código: Gobierno de datos, calidad, exportaciones, reportes, consentimientos y contenido de la app.
 * @business Lo que Atlas guarda y lo que le dice al cliente tiene que ser correcto y estar gobernado: políticas de datos, reglas de calidad con incidencias que alguien resuelve, reportes, documentos legales versionados y textos de la app que negocio edita sin ingeniería.
 * @system fixture P-37 que `syncWorkflowCatalog` vuelca a `workflow_*`; `catalog-governance.controller.ts`, `data-quality.controller.ts`, `internal-portal.controller.ts`, `consent-operations.controller.ts` y `app-content-operations.controller.ts`, más el job `recalculate_data_quality`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** `INTERNAL_PORTAL_ROLES` de `internal-portal.controller.ts`. */
const PORTAL = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'admin',
  'platform_admin',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
];
/** Roles de lectura de políticas y de incidencias de calidad. */
const GOVERNANCE_READ = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin'];
const ADMIN_WRITE = ['admin', 'platform_admin'];
/** Roles de clase de `ConsentOperationsController`. */
const CONSENT_OPS = ['internal_operator', 'compliance_analyst', 'risk_analyst', 'admin', 'platform_admin'];
/** Roles de clase de `AppContentOperationsController`. */
const APP_CONTENT_READ = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'readonly_auditor', 'admin', 'platform_admin'];
const APP_CONTENT_WRITE = ['admin', 'platform_admin'];

export const DATA_GOVERNANCE_QUALITY_REPORTS: WorkflowDefinitionFixture = {
  processId: 'P-37',
  code: 'data_governance_quality_reports',
  version: 'v1',
  name: 'Gobierno de datos, calidad, exportaciones, reportes, consentimientos y contenido de la app',
  description:
    'Gobierno del dato y de lo que se publica: paquete de políticas de datos, reglas de calidad recalculadas por un job que abre incidencias para que alguien las resuelva, consulta de exportaciones, reportes calculados en vivo, documentos de consentimiento versionados, contenidos de la app y la lista de comprobación de preparación de salida.',
  processType: 'back_office',
  ownerDomain: 'data_governance',
  ownerRole: 'DATA_GOVERNANCE_MANAGER',
  priority: 'P2',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Lo que Atlas guarda y lo que le dice al cliente tiene que ser correcto y gobernado: políticas de datos con retención, reglas de calidad cuyas incidencias alguien resuelve, textos legales versionados que el cliente acepta en el alta, y contenidos de la app que negocio edita sin pasar por ingeniería.',
    whoStartsAndCloses:
      'Lo inicia gobierno de datos al definir el paquete de políticas o una regla, o el job recalculate_data_quality al abrir incidencias; lo cierran analistas y operadores internos al resolver o ignorar cada incidencia, publicar un documento legal o guardar un contenido de la app.',
    startAndEnd:
      'Empieza con una política, una regla, un reporte o un documento definidos; termina con la incidencia resuelta o ignorada, el reporte calculado (en vivo, sin guardar), el documento de consentimiento en published con su versión, y la preparación de salida sin controles bloqueados.',
    whenItFails:
      'Una incidencia abierta queda en «Incidencias de calidad» hasta que alguien la resuelve y cuenta en la preparación de salida; un reporte no se guarda, así que no hay histórico que recuperar. Hoy no hay botón para publicar un documento legal aunque el portal tiene el gancho escrito, y las exportaciones sólo se consultan: nadie las crea.',
    healthIndicator:
      'Incidencias de calidad pendientes (sin revisar o reconocidas: todas las que no están resolved, ignored ni closed), reglas sin evaluar, documentos legales vigentes por código y los controles de la preparación de salida en ok, warning o blocked.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'audit',
    table: 'data_quality_issues',
    idColumn: '_id',
    statusColumn: 'issue_status',
    labelColumn: 'target_table',
    // Reconocer no cierra: una incidencia reconocida sigue pendiente de corregir (y cuenta en la preparación de salida).
    openStatuses: ['open', 'acknowledged'],
  },
  success:
    'Las políticas están vigentes, las incidencias de calidad se resuelven, los documentos legales están publicados y la preparación de salida no tiene bloqueos.',
  failure: 'Las incidencias se acumulan sin dueño, un texto legal nuevo no llega a publicarse o la preparación de salida queda bloqueada.',
  sources: [
    'src/modules/catalog-management/catalog-governance.controller.ts',
    'src/modules/data-quality/data-quality.controller.ts',
    'src/modules/data-quality/data-quality.schemas.ts',
    'src/modules/internal-portal/internal-portal.controller.ts',
    'src/modules/internal-portal/application/portal-reports.service.ts',
    'src/modules/consents/consent-operations.controller.ts',
    'src/modules/app-content/app-content-operations.controller.ts',
    'src/modules/runtime-jobs/scheduled-jobs.catalog.ts',
    '/private/tmp/fi-root-20260926/AtlasAdminPortal/src/features/consent-documents/hooks.ts',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-37)',
  ],
  stages: [
    {
      code: 'governance_policies',
      name: 'Políticas de datos',
      description: 'Gobierno de datos consulta las políticas vigentes y publica el paquete de políticas (con clave de idempotencia).',
      module: 'catalog_management',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/governance/policies',
      entry: true,
      roles: GOVERNANCE_READ,
      steps: [
        {
          code: 'gov.list_policies',
          name: 'Ver las políticas',
          description: 'Políticas de datos vigentes del tenant.',
          method: 'GET',
          path: '/operations/data-governance/policies',
          roles: GOVERNANCE_READ,
        },
        {
          code: 'gov.policy_detail',
          name: 'Ver una política',
          description: 'Detalle de una política desde el portal.',
          method: 'GET',
          path: '/internal/governance/policies/:policyId',
          roles: PORTAL,
          optional: true,
        },
        {
          code: 'gov.policy_package',
          name: 'Publicar el paquete de políticas',
          description: 'Crea o actualiza el paquete completo; exige x-idempotency-key. Se edita en «Paquete de políticas».',
          method: 'POST',
          path: '/operations/data-governance/policy-package',
          roles: ADMIN_WRITE,
          idempotencyKey: true,
          optional: true,
        },
      ],
    },
    {
      code: 'quality_recalculation',
      name: 'Recalcular la calidad',
      description: 'El job evalúa las reglas de calidad y abre incidencias por registro que no las cumple.',
      module: 'runtime_jobs',
      actor: 'system',
      client: 'BLOCK',
      resultingStates: ['open'],
      steps: [
        {
          code: 'dq.recalculate',
          name: 'Recalcular la calidad de datos',
          description: 'Corre con su intervalo en el planificador (P-33).',
          kind: 'job',
          job: 'recalculate_data_quality',
          resultingStates: ['open'],
        },
      ],
    },
    {
      code: 'quality_issues',
      name: 'Incidencias de calidad',
      description: 'El analista revisa las reglas y reconoce, resuelve o descarta cada incidencia pendiente, siempre con motivo y notas.',
      module: 'data_quality',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/data-quality/issues',
      roles: GOVERNANCE_READ,
      requiredStates: ['open', 'acknowledged'],
      resultingStates: ['acknowledged', 'resolved', 'ignored'],
      steps: [
        {
          code: 'dq.list_rules',
          name: 'Ver las reglas de calidad',
          description: 'Reglas definidas; se ven en «Reglas de calidad».',
          method: 'GET',
          path: '/internal/data-quality/rules',
          roles: PORTAL,
          optional: true,
        },
        {
          code: 'dq.list_issues',
          name: 'Listar incidencias',
          description: 'Incidencias por estado y severidad, con búsqueda por tabla, código de regla o notas y conteos del filtro entero.',
          method: 'GET',
          path: '/operations/data-quality/issues',
          roles: GOVERNANCE_READ,
        },
        {
          code: 'dq.resolve_issue',
          name: 'Reconocer, resolver o descartar una incidencia',
          description: 'resolution: acknowledged (sigue pendiente), resolved o ignored (cierran), con motivo y notas.',
          method: 'POST',
          path: '/operations/data-quality/issues/:issueId/resolve',
          roles: GOVERNANCE_READ,
          resultingStates: ['acknowledged', 'resolved', 'ignored'],
        },
      ],
    },
    {
      code: 'exports_and_reports',
      name: 'Exportaciones y reportes',
      description:
        'El operador consulta exportaciones y calcula un reporte en vivo sobre los datos de su tenant (persisted: false, sin histórico).',
      module: 'internal_portal',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/reports/[reportId]',
      optional: true,
      roles: PORTAL,
      steps: [
        {
          code: 'rep.list_exports',
          name: 'Listar exportaciones',
          description: 'Sólo lectura; se ve en «Exportaciones».',
          method: 'GET',
          path: '/internal/exports',
          roles: PORTAL,
          optional: true,
        },
        {
          code: 'rep.export_detail',
          name: 'Ver una exportación',
          description: 'Detalle de la exportación.',
          method: 'GET',
          path: '/internal/exports/:exportId',
          roles: PORTAL,
          optional: true,
        },
        {
          code: 'rep.list_reports',
          name: 'Listar reportes',
          description: 'Reportes disponibles.',
          method: 'GET',
          path: '/internal/reports',
          roles: PORTAL,
        },
        {
          code: 'rep.run_report',
          name: 'Calcular un reporte',
          description: 'Calcula en vivo y no guarda nada.',
          method: 'POST',
          path: '/internal/reports/:reportId/run',
          roles: PORTAL,
          successStatus: [200],
        },
      ],
    },
    {
      code: 'consent_documents',
      name: 'Documentos de consentimiento',
      description:
        'Cumplimiento crea una versión nueva de un documento legal y la edita; la versión published es la que la app muestra y el cliente acepta en el alta.',
      module: 'consents',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/settings/consent-documents',
      roles: CONSENT_OPS,
      resultingStates: ['draft', 'published', 'retired'],
      steps: [
        {
          code: 'consent.list',
          name: 'Listar documentos',
          description: 'Versiones por código de documento.',
          method: 'GET',
          path: '/operations/consent-documents',
          roles: CONSENT_OPS,
        },
        {
          code: 'consent.create',
          name: 'Crear una versión',
          description: 'Nueva versión con título, cuerpo y vigencia.',
          method: 'POST',
          path: '/operations/consent-documents',
          roles: CONSENT_OPS,
          resultingStates: ['draft'],
        },
        {
          code: 'consent.update',
          name: 'Editar o publicar una versión',
          description:
            'El cambio de estado admite draft, published y retired; el portal tiene usePublishConsentDocument pero ningún botón lo llama.',
          method: 'PATCH',
          path: '/operations/consent-documents/:documentId',
          roles: CONSENT_OPS,
          resultingStates: ['published', 'retired'],
        },
        {
          code: 'consent.active_public',
          name: 'Documento vigente para la app',
          description: 'Lo que la app muestra antes del alta.',
          method: 'GET',
          path: '/consent-documents/active',
          auth: false,
        },
      ],
    },
    {
      code: 'app_content',
      name: 'Contenido de la app',
      description: 'Negocio edita los textos que lee el cliente en la app sin pasar por ingeniería.',
      module: 'app_content',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/settings/app-content',
      optional: true,
      roles: APP_CONTENT_READ,
      steps: [
        {
          code: 'content.list',
          name: 'Listar contenidos',
          description: 'Entradas del catálogo de contenidos.',
          method: 'GET',
          path: '/operations/app-content',
          roles: APP_CONTENT_READ,
        },
        {
          code: 'content.upsert',
          name: 'Guardar un contenido',
          description: 'Crea o reemplaza una entrada.',
          method: 'PUT',
          path: '/operations/app-content',
          roles: APP_CONTENT_WRITE,
        },
        {
          code: 'content.delete',
          name: 'Borrar un contenido',
          description: 'Retira una entrada.',
          method: 'DELETE',
          path: '/operations/app-content/:contentId',
          roles: APP_CONTENT_WRITE,
          optional: true,
        },
      ],
    },
    {
      code: 'release_readiness_check',
      name: 'Preparación de salida',
      description:
        'Lista de comprobación: catálogo de rutas y de datos poblados, suites QA, reglas e incidencias de calidad y corridas de jobs.',
      module: 'internal_portal',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/release-readiness',
      terminal: true,
      roles: PORTAL,
      steps: [
        {
          code: 'gov.release_readiness',
          name: 'Leer la preparación de salida',
          description: 'Cada control en ok, warning o blocked.',
          method: 'GET',
          path: '/internal/release-readiness',
          roles: PORTAL,
        },
      ],
    },
  ],
  metadata: {
    gaps: [
      'usePublishConsentDocument existe y no hay botón de publicar.',
      'Las exportaciones sólo se leen: no hay ruta que las cree ni las entregue.',
      'Los reportes se calculan en vivo sin persistir (persisted: false); sólo 1 de 4 declara permiso.',
      'Cuatro ítems de Gobierno sin gate en la página.',
      'El inventario da estados open/resolved para incidencias; el código resuelve con resolved o ignored.',
    ],
  },
};
