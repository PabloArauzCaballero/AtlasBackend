/**
 * @file Proceso declarado en código: Cambios de esquema: propuestas, versiones, change log y aprobación.
 * @business Un cambio de estructura de datos afecta a todo lo que lee esa tabla; este proceso obliga a proponerlo, a que lo apruebe otra persona y a dejarlo registrado antes de que una migración lo aplique.
 * @system fixture P-35 que `syncWorkflowCatalog` vuelca a `workflow_*`; `schema-management.controller.ts` sobre `schema_versions`, `schema_tables` y `schema_change_log` (sin DDL físico: ATLAS-TECH-007).
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** Roles de lectura de `SchemaManagementController`. */
const SCHEMA_READ = ['internal_operator', 'admin', 'platform_admin', 'risk_analyst', 'readonly_auditor'];
/**
 * Roles de sesión que dejan pasar las escrituras. En sesión interna decide el permiso fino
 * (`governance.schema.propose` / `governance.schema.approve`); en sesión de plataforma, el rol.
 */
const SCHEMA_WRITE = ['internal_operator', 'admin', 'platform_admin', 'risk_analyst', 'fraud_analyst', 'compliance_analyst', 'qa_engineer'];

export const SCHEMA_CHANGE_MANAGEMENT: WorkflowDefinitionFixture = {
  processId: 'P-35',
  code: 'schema_change_management',
  version: 'v1',
  name: 'Cambios de esquema: propuestas, versiones, change log y aprobación',
  description:
    'Gestión gobernada del catálogo de esquema: consultar versiones y tablas, proponer una tabla nueva (queda pending en el change log), aprobarla o rechazarla con el principio de cuatro ojos, y aplicar el cambio real por una migración revisada en PR, porque la aprobación no ejecuta DDL.',
  processType: 'back_office',
  ownerDomain: 'data_governance',
  ownerRole: 'DATA_GOVERNANCE_MANAGER',
  priority: 'P2',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Gobierna las propuestas de estructura sin permitir cambios directos desde el portal: las relaciones son inmutables, las columnas críticas no se editan y un catálogo en uso exige versión nueva, así que cada cambio queda propuesto, decidido por otra persona y auditado en el change log.',
    whoStartsAndCloses:
      'Lo inicia una persona interna con el permiso governance.schema.propose que propone una tabla desde «Versiones de esquema»; lo cierra otra persona con governance.schema.approve (o una sesión de plataforma platform_admin) que aprueba o rechaza en «Change log» —quien propone no puede aprobar—, y después un desarrollador aplica la migración, que se enlaza al cambio con linkSchemaChangeToMigration.',
    startAndEnd:
      'Empieza con la propuesta, que entra en schema_change_log como pending; termina cuando el cambio queda approved o rejected (rechazar exige notas) y, si se aprobó, cuando la migración Sequelize que lo materializa se despliega y deja su nombre en applied_by_migration.',
    whenItFails:
      'Aprobar un cambio ya resuelto da 409; sin el permiso fino (sesión interna) o sin rol (sesión de plataforma) da 403, que nombra el permiso que falta; aprobar lo que uno mismo propuso da 403. El gate check:domain-schema-layout mira la base real, no este catálogo.',
    healthIndicator:
      'Propuestas en pending y su antigüedad, cambios aprobados con applied_by_migration vacío (sin migración que los aplique) y diferencia entre el catálogo de versiones y la base real; se ve en «Change log» del portal.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'platform_ops',
    table: 'schema_change_log',
    idColumn: '_id',
    statusColumn: 'approval_status',
    openStatuses: ['pending'],
  },
  success: 'El cambio está propuesto, aprobado por otra persona, registrado y aplicado por una migración.',
  failure: 'La propuesta queda pending sin nadie que pueda aprobarla, o el cambio se aplica por migración sin pasar por el change log.',
  sources: [
    'src/modules/schema-management/README.md',
    'src/modules/schema-management/schema-management.controller.ts',
    'src/modules/schema-management/schema-change-log.repository.ts',
    'src/modules/schema-management/services/schema-management.service.ts',
    'src/modules/schema-management/services/schema-change-actor.ts',
    'src/modules/schema-management/schema-change-authorization.guard.ts',
    'src/database/migration-support/schema-change-link.util.ts',
    'src/modules/internal-users/internal-rbac.roles.ts (legacyRoleForInternalRoles)',
    'src/modules/systems-ops/systems-ops.constants.ts',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-35)',
  ],
  stages: [
    {
      code: 'schema_browse',
      name: 'Consulta de versiones y tablas',
      description: 'Versiones del esquema (append-only), sus tablas, columnas y relaciones.',
      module: 'schema_management',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/schema/versions',
      entry: true,
      roles: SCHEMA_READ,
      steps: [
        {
          code: 'schema.list_versions',
          name: 'Listar versiones',
          description: 'Versiones con conteos.',
          method: 'GET',
          path: '/operations/schema/versions',
          roles: SCHEMA_READ,
        },
        {
          code: 'schema.version_detail',
          name: 'Ver una versión',
          description: 'Detalle de la versión.',
          method: 'GET',
          path: '/operations/schema/versions/:versionId',
          roles: SCHEMA_READ,
          optional: true,
        },
        {
          code: 'schema.version_schemas',
          name: 'Ver los esquemas de una versión',
          description: 'Esquemas y tablas agrupadas.',
          method: 'GET',
          path: '/operations/schema/versions/:versionId/schemas',
          roles: SCHEMA_READ,
          optional: true,
        },
        {
          code: 'schema.list_tables',
          name: 'Listar tablas de una versión',
          description: 'Inventario de tablas por versión.',
          method: 'GET',
          path: '/operations/schema/tables',
          roles: SCHEMA_READ,
        },
        {
          code: 'schema.table_detail',
          name: 'Ver una tabla',
          description: 'Tabla con columnas y relaciones.',
          method: 'GET',
          path: '/operations/schema/tables/:tableId',
          roles: SCHEMA_READ,
          optional: true,
        },
      ],
    },
    {
      code: 'schema_propose',
      name: 'Propuesta de tabla',
      description: 'La persona propone una tabla desde el formulario de «Versiones»; entra en el change log como pending.',
      module: 'schema_management',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/schema/versions',
      roles: SCHEMA_WRITE,
      resultingStates: ['pending'],
      steps: [
        {
          code: 'schema.propose_table',
          name: 'Proponer una tabla',
          description:
            'Valida identificadores en dos capas y registra la propuesta con su proponente (interno o de plataforma). Sesión interna: permiso governance.schema.propose.',
          method: 'POST',
          path: '/operations/schema/tables',
          roles: SCHEMA_WRITE,
          resultingStates: ['pending'],
          errors: ['400 validación', '403 sin governance.schema.propose, sin rol o sin actor identificado en el token'],
        },
      ],
    },
    {
      code: 'schema_approve',
      name: 'Aprobación del cambio',
      description:
        'Otra persona aprueba o rechaza la propuesta con SELECT … FOR UPDATE; el proponente no puede aprobar y rechazar exige notas.',
      module: 'schema_management',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/schema/change-log',
      roles: SCHEMA_WRITE,
      requiredStates: ['pending'],
      resultingStates: ['approved', 'rejected'],
      steps: [
        {
          code: 'schema.change_log',
          name: 'Leer el change log',
          description: 'Auditoría filtrable de propuestas y decisiones.',
          method: 'GET',
          path: '/operations/schema/change-log',
          roles: SCHEMA_READ,
        },
        {
          code: 'schema.approve_change',
          name: 'Aprobar o rechazar',
          description:
            'Sesión interna con governance.schema.approve o sesión de plataforma platform_admin; sólo se resuelve lo pending. Registra la decisión, no ejecuta DDL.',
          method: 'PATCH',
          path: '/operations/schema/change-log/:changeId/approve',
          roles: SCHEMA_WRITE,
          requiredStates: ['pending'],
          resultingStates: ['approved', 'rejected'],
          errors: ['403 sin governance.schema.approve, rol insuficiente o proponente = aprobador', '404', '409 cambio ya resuelto'],
        },
      ],
    },
    {
      code: 'schema_apply_migration',
      name: 'Aplicación por migración',
      description:
        'El CREATE TABLE real sale por una migración Sequelize revisada en PR y aplicada por el job migrate al desplegar (P-38).',
      module: 'schema_management',
      actor: 'system',
      client: 'BLOCK',
      terminal: true,
      requiredStates: ['approved'],
      steps: [
        {
          code: 'schema.migration',
          name: 'Migración que materializa el cambio',
          description:
            'Opción C aprobada: nada del portal ejecuta DDL físico. La migración llama a linkSchemaChangeToMigration con el id del cambio para dejar el enlace.',
          kind: 'manual',
          reason:
            'ATLAS-TECH-007: la ejecución de DDL por API está fuera del MVP; el cambio real es una migración en PR que corre al desplegar.',
        },
      ],
    },
  ],
  metadata: {
    gaps: [
      'Pantallas sin gate de permiso en la página.',
      'check:domain-schema-layout consulta la base real, no este catálogo: dos verdades.',
      'El enlace aprobación → migración depende de que la migración llame a linkSchemaChangeToMigration: nada obliga a hacerlo, y en una base donde el cambio no existe no enlaza nada.',
    ],
  },
};
