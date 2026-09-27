/**
 * @file Proceso declarado en código: Catálogo de sistemas: descubrimiento, introspección, narrativas, revisión humana y federación.
 * @business Sin un catálogo fiel de rutas, tablas y dueños nadie puede decir qué toca un cambio ni quién responde por un dato; este proceso lo mantiene poblado y firmado por una persona.
 * @system fixture P-30 que `syncWorkflowCatalog` vuelca a `workflow_*`; rutas de `systems-ops` (catálogo, revisión, red de bloques) y linaje de `internal-portal`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** `SYSTEMS_OPS_ROLES`: roles de clase de `@SystemsOpsControllerSecurity()` (lectura). */
const SYSTEMS_OPS_READ = [
  'system_admin',
  'platform_admin',
  'admin',
  'qa_engineer',
  'devops',
  'risk_analyst',
  'compliance_analyst',
  'readonly_auditor',
];
/** `SYSTEMS_OPS_GOVERNANCE_ROLES`: escritura y revisión del catálogo. */
const GOVERNANCE = ['system_admin', 'platform_admin', 'admin'];
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

export const SYSTEMS_CATALOG_GOVERNANCE: WorkflowDefinitionFixture = {
  processId: 'P-30',
  code: 'systems_catalog_governance',
  version: 'v1',
  name: 'Catálogo de sistemas: descubrimiento, introspección, narrativas, revisión humana y federación',
  description:
    'Cómo se llena y se firma el catálogo técnico de Atlas: escaneo del código para descubrir rutas, introspección de la base para columnas y relaciones, narrativas de negocio por tabla, federación de los catálogos del Motor y del ERP, y revisión humana de lo que la máquina detectó.',
  processType: 'back_office',
  ownerDomain: 'platform',
  ownerRole: 'DATA_GOVERNANCE_MANAGER',
  priority: 'P2',
  systems: ['ATLAS_BACKEND', 'DECISION_ENGINE', 'ERP_BACKEND'],
  narrative: {
    whyExists:
      'Sin un catálogo fiel de rutas, tablas, relaciones y dueños nadie puede decir qué toca un cambio ni quién responde por un dato. El linaje del portal no dibujaba relaciones porque el catálogo de relaciones estaba vacío con 400 claves foráneas reales en la base: este proceso es el que lo mantiene poblado.',
    whoStartsAndCloses:
      'Lo inicia un administrador de sistemas (rol de sesión admin o system_admin) desde «Sincronización del catálogo», o un guion yarn systems:catalog:* en el servidor; lo cierra la persona de gobierno de datos que aprueba o rechaza cada ficha en la cola de revisión.',
    startAndEnd:
      'Empieza con el descubrimiento (escaneo del código) o el refresco de la siembra del catálogo, que deja fichas en AUTO_DETECTED; lo curado pasa a NEEDS_REVIEW, nunca a APPROVED; termina cuando una persona firma cada ficha como APPROVED o REJECTED.',
    whenItFails:
      'Si la introspección nunca corrió no hay columnas ni relaciones y el linaje sale vacío sin error; si la federación falla, las fichas del Motor o del ERP quedan viejas. Hoy la cola de revisión del portal es de sólo lectura: nadie llama a las seis rutas de revisión y las fichas se quedan en NEEDS_REVIEW sin aviso.',
    healthIndicator:
      'Fichas en NEEDS_REVIEW frente a APPROVED por bloque, filas con detected_from = information_schema_enriched (señal de que la introspección corrió) y el control «Catálogo de endpoints poblado» de la preparación de salida.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'platform_ops',
    table: 'system_endpoint_catalog',
    idColumn: '_id',
    statusColumn: 'review_status',
    labelColumn: 'full_path',
    openStatuses: ['AUTO_DETECTED', 'NEEDS_REVIEW'],
  },
  success: 'Las fichas de rutas, tablas y relaciones de los tres bloques existen, llevan narrativa y están firmadas por una persona.',
  failure:
    'El catálogo queda vacío, desactualizado o con fichas que nadie revisa, y el linaje y el impacto de cambios mienten por omisión.',
  sources: [
    'src/modules/systems-ops/systems-catalog.controller.ts',
    'src/modules/systems-ops/systems-review.controller.ts',
    'src/modules/systems-ops/systems-network.controller.ts',
    'src/modules/systems-ops/systems-ops.constants.ts',
    'src/modules/internal-portal/internal-portal.controller.ts',
    'package.json (systems:catalog:introspect, :narratives, :business)',
    'memoria atlas-linaje-catalogo-relaciones',
    'memoria atlas-flow-intelligence-ya-existe',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-30)',
  ],
  stages: [
    {
      code: 'catalog_discovery',
      name: 'Descubrimiento e introspección',
      description:
        'El administrador lanza desde «Sincronización del catálogo» el escaneo del código y el refresco de la siembra, que arrastra herramientas, rutas y la introspección de la base (columnas y relaciones).',
      module: 'systems_ops',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/settings/catalog-sync',
      entry: true,
      roles: GOVERNANCE,
      resultingStates: ['AUTO_DETECTED'],
      steps: [
        {
          code: 'catalog.discover_endpoints',
          name: 'Descubrir rutas en el código',
          description: 'Escanea el código fuente de los controladores y da de alta las rutas que faltan en el catálogo.',
          method: 'POST',
          path: '/systems/endpoints/discover',
          roles: GOVERNANCE,
          resultingStates: ['AUTO_DETECTED'],
          successStatus: [201],
        },
        {
          code: 'catalog.refresh_seed',
          name: 'Refrescar la siembra del catálogo',
          description:
            'Refresca herramientas, entidades y rutas; incluye la introspección de information_schema que escribe columnas y una relación FOREIGN_KEY por cada clave foránea.',
          method: 'POST',
          path: '/systems/endpoints/catalog-seed/refresh',
          roles: GOVERNANCE,
          idempotencyKey: false,
          successStatus: [201],
        },
        {
          code: 'catalog.infer_tool_requirements',
          name: 'Inferir requisitos de herramientas',
          description: 'Deduce qué herramientas de plataforma necesita cada ruta catalogada.',
          method: 'POST',
          path: '/systems/tools/infer-requirements',
          roles: GOVERNANCE,
          optional: true,
        },
        {
          code: 'catalog.infer_data_impacts',
          name: 'Inferir impactos ruta → tabla',
          description: 'Deduce del código qué tablas lee o escribe cada ruta; alimenta el linaje ruta → tabla.',
          method: 'POST',
          path: '/systems/data-entities/infer-impacts',
          roles: GOVERNANCE,
          optional: true,
        },
        {
          code: 'catalog.apply_narratives_script',
          name: 'Aplicar narrativas y metadata de negocio por guion',
          description:
            'yarn systems:catalog:introspect, :narratives y :business aplican introspección, las cinco preguntas por tabla y dominios/relaciones lógicas; lo curado queda en NEEDS_REVIEW.',
          kind: 'manual',
          reason:
            'Son guiones del repositorio que se ejecutan con docker exec en el contenedor del servidor; no hay pantalla ni ruta que los dispare.',
          optional: true,
          resultingStates: ['NEEDS_REVIEW'],
        },
      ],
    },
    {
      code: 'catalog_federation',
      name: 'Federación de bloques',
      description:
        'Trae el manifiesto de catálogo del Motor y del ERP y lo guarda con su system_code; se autentica con el token del usuario, no con un secreto de máquina.',
      module: 'systems_ops',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/systems/network-health',
      roles: GOVERNANCE,
      steps: [
        {
          code: 'catalog.list_blocks',
          name: 'Ver los bloques federados',
          description: 'Lista los bloques conocidos y el estado de su última federación.',
          method: 'GET',
          path: '/systems/blocks',
          roles: SYSTEMS_OPS_READ,
        },
        {
          code: 'catalog.federate_all',
          name: 'Federar todos los bloques',
          description: 'Pide a cada bloque su manifiesto de catálogo y lo vuelca en las fichas con su system_code.',
          method: 'POST',
          path: '/systems/blocks/federate',
          roles: GOVERNANCE,
        },
        {
          code: 'catalog.federate_one',
          name: 'Federar un bloque',
          description: 'Federa sólo el bloque indicado (DECISION_ENGINE o ERP_BACKEND).',
          method: 'POST',
          path: '/systems/blocks/:systemCode/federate',
          roles: GOVERNANCE,
          optional: true,
        },
        {
          code: 'catalog.engine_manifest',
          name: 'Manifiesto de catálogo del Motor',
          description: 'El Motor sirve su inventario de rutas y tablas para la federación.',
          system: 'DECISION_ENGINE',
          method: 'GET',
          path: '/v1/platform/catalog-manifest',
        },
        {
          code: 'catalog.erp_manifest',
          name: 'Manifiesto de catálogo del ERP',
          description: 'El ERP sirve su inventario de rutas y tablas para la federación.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/platform/catalog-manifest',
        },
      ],
    },
    {
      code: 'catalog_browse',
      name: 'Consulta y metadata de negocio',
      description:
        'Gobierno de datos consulta rutas y tablas catalogadas y completa la metadata de negocio de una tabla (dueño, propósito, sensibilidad).',
      module: 'systems_ops',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/data-catalog/tables/[entityId]/metadata',
      steps: [
        {
          code: 'catalog.list_endpoints',
          name: 'Listar rutas catalogadas',
          description: 'Lista paginada de rutas con su riesgo, módulo y estado de revisión.',
          method: 'GET',
          path: '/systems/endpoints',
          roles: SYSTEMS_OPS_READ,
        },
        {
          code: 'catalog.list_entities',
          name: 'Listar tablas catalogadas',
          description: 'Lista paginada de entidades de datos de los tres bloques.',
          method: 'GET',
          path: '/systems/data-entities',
          roles: SYSTEMS_OPS_READ,
        },
        {
          code: 'catalog.entity_metadata',
          name: 'Editar la metadata de negocio de una tabla',
          description: 'Guarda propósito, dueño y clasificación de la tabla en su ficha.',
          method: 'PATCH',
          path: '/systems/data-entities/:entityId/metadata',
          roles: GOVERNANCE,
          optional: true,
        },
        {
          code: 'catalog.lineage',
          name: 'Ver el linaje',
          description: 'Grafo ruta → tabla y tabla → tabla; una arista sólo se dibuja si sus dos extremos están cargados.',
          method: 'GET',
          path: '/internal/lineage',
          roles: PORTAL,
          optional: true,
        },
        {
          code: 'catalog.lineage_impact',
          name: 'Ver el impacto de una tabla',
          description: 'Qué rutas y tablas se ven afectadas si cambia una tabla.',
          method: 'GET',
          path: '/internal/lineage/impact',
          roles: PORTAL,
          optional: true,
        },
      ],
    },
    {
      code: 'catalog_human_review',
      name: 'Revisión humana',
      description:
        'La persona de gobierno aprueba o rechaza lo detectado por la máquina. La pantalla «Cola de revisión» sólo lista: las seis rutas de revisión no tienen llamador en el portal.',
      module: 'systems_ops',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/review-queue',
      terminal: true,
      roles: GOVERNANCE,
      requiredStates: ['AUTO_DETECTED', 'NEEDS_REVIEW'],
      resultingStates: ['APPROVED', 'REJECTED'],
      steps: [
        {
          code: 'catalog.review_queue',
          name: 'Leer la cola de revisión',
          description: 'Fichas pendientes por tipo (ruta, tabla, columna, impacto, requisito).',
          method: 'GET',
          path: '/systems/review-queue',
          roles: GOVERNANCE,
        },
        {
          code: 'catalog.review_endpoint',
          name: 'Firmar una ruta',
          description: 'Aprueba o rechaza una ruta catalogada. Sin llamador en el portal.',
          method: 'PATCH',
          path: '/systems/endpoints/:endpointId/review',
          roles: GOVERNANCE,
          resultingStates: ['APPROVED', 'REJECTED'],
        },
        {
          code: 'catalog.review_entity',
          name: 'Firmar una tabla',
          description: 'Aprueba o rechaza una entidad de datos. Sin llamador en el portal.',
          method: 'PATCH',
          path: '/systems/data-entities/:entityId/review',
          roles: GOVERNANCE,
          resultingStates: ['APPROVED', 'REJECTED'],
        },
        {
          code: 'catalog.review_column',
          name: 'Firmar una columna',
          description: 'Aprueba o rechaza una columna. Sin llamador en el portal.',
          method: 'PATCH',
          path: '/systems/data-entities/columns/:columnId/review',
          roles: GOVERNANCE,
          optional: true,
        },
        {
          code: 'catalog.review_data_impact',
          name: 'Firmar un impacto ruta → tabla',
          description: 'Aprueba o rechaza un impacto inferido. Sin llamador en el portal.',
          method: 'PATCH',
          path: '/systems/impact/data/:impactId/review',
          roles: GOVERNANCE,
          optional: true,
        },
        {
          code: 'catalog.review_field_impact',
          name: 'Firmar un impacto sobre un campo',
          description: 'Aprueba o rechaza un impacto a nivel de campo. Sin llamador en el portal.',
          method: 'PATCH',
          path: '/systems/impact/fields/:fieldImpactId/review',
          roles: GOVERNANCE,
          optional: true,
        },
        {
          code: 'catalog.review_tool_requirement',
          name: 'Firmar un requisito de herramienta',
          description: 'Aprueba o rechaza un requisito inferido. Sin llamador en el portal.',
          method: 'PATCH',
          path: '/systems/tools/requirements/:requirementId/review',
          roles: GOVERNANCE,
          optional: true,
        },
      ],
    },
  ],
  metadata: {
    gaps: [
      'Las seis rutas PATCH systems/*/review no tienen llamador: /internal/review-queue es de sólo lectura.',
      'system_endpoint_payload_contracts no la escribe nadie.',
      'Los guiones systems:catalog:* no tienen pantalla ni job: sólo docker exec.',
    ],
  },
};
