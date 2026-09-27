/**
 * @file Proceso declarado en código: Derechos del titular (ARCO), retención y supresión.
 * @business Atlas guarda datos personales y decisiones de crédito sobre cada cliente; este proceso es el camino por el que la persona pide ver, corregir, llevarse o borrar esos datos, y por el que la retención limpia lo que ya no hace falta conservar.
 * @system fixture que `syncWorkflowCatalog` vuelca a `workflow_*`; escrita el 2026-09-26 desde `customer-privacy`, `runtime-jobs` y el módulo `data-subject` del Motor.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

export const CUSTOMER_PRIVACY_DSR: WorkflowDefinitionFixture = {
  processId: 'P-11',
  code: 'customer_privacy_dsr',
  version: 'v1',
  name: 'Derechos del titular (ARCO), retención y supresión',
  description:
    'El cliente pide desde la app ver, corregir, llevarse, limitar o borrar sus datos, o retirar consentimientos; la solicitud queda registrada con plazo de 15 días. En paralelo, la retención programada purga telemetría cruda, y el Motor resuelve por su lado las solicitudes sobre decisiones automatizadas.',
  processType: 'back_office',
  ownerDomain: 'customer_privacy',
  ownerRole: 'DATA_GOVERNANCE_MANAGER',
  priority: 'P0',
  systems: ['ATLAS_BACKEND', 'DECISION_ENGINE'],
  narrative: {
    whyExists:
      'La persona tiene derecho a saber qué datos suyos guarda Atlas, a corregirlos, a llevárselos, a limitar su uso y a pedir que se borren; y Atlas tiene que poder demostrar que atendió cada pedido dentro del plazo. Además, la telemetría cruda (GPS, dispositivo, interacción con formularios) no debe guardarse más de lo que dice su política.',
    whoStartsAndCloses:
      'Lo inicia el cliente desde la pantalla «Privacidad» de la app, eligiendo el derecho que quiere ejercer, o el propio sistema con la tarea programada de retención. Debería cerrarlo el equipo de gobierno de datos (DATA_GOVERNANCE_MANAGER) resolviendo la solicitud; hoy nadie puede cerrarla desde el portal. En el Motor, cumplimiento u operaciones atienden la parte de decisiones automatizadas.',
    startAndEnd:
      'Empieza cuando la app registra la solicitud (estado `received`, vencimiento a 15 días desde la recepción). Debería terminar con la solicitud resuelta y fechada (`resolved_at`, `handled_by`, notas de resolución) en Atlas y con su espejo en el Motor en FULFILLED o REJECTED; hoy ningún paso escribe esa resolución en Atlas.',
    whenItFails:
      'Si falta la clave de idempotencia responde 400; si un cliente intenta pedir sobre otra cuenta, 403; si el cliente no existe, 404. El fallo grave es silencioso: la solicitud queda `received` para siempre, vence el plazo legal de 15 días y nadie se entera, porque no hay cola interna ni aviso. Un borrado en el Motor con decisiones previas se rechaza a propósito por obligación legal de conservar la evidencia.',
    healthIndicator:
      'Solicitudes en `received` con `due_at` vencido (debe ser cero) y tiempo medio entre `requested_at` y `resolved_at`, ambos leídos de `data_subject_requests`; para la retención, que cada corrida de `apply_retention_policies` termine sin políticas activas sin destino ejecutable.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'privacy',
    table: 'data_subject_requests',
    idColumn: '_id',
    statusColumn: 'status',
    labelColumn: 'request_code',
    openStatuses: ['received'],
  },
  success:
    'La solicitud del titular queda resuelta y fechada en Atlas y en el Motor dentro del plazo, y la retención purga sólo lo que su política permite.',
  failure: 'La solicitud vence sin respuesta, se borra algo que la ley obliga a conservar o queda una copia fuera del borrado.',
  sources: [
    'src/modules/customer-privacy/customer-privacy.controller.ts',
    'src/modules/customer-privacy/customer-privacy.service.ts',
    'src/modules/customer-privacy/customer-privacy.repository.ts',
    'src/modules/customer-privacy/customer-privacy.schemas.ts',
    'src/database/models/data-subject-requests.model.ts',
    'src/modules/runtime-jobs/scheduled-jobs.catalog.ts',
    'src/modules/runtime-jobs/runtime-jobs.controller.ts',
    'src/modules/runtime-jobs/retention-targets.ts',
    'AtlasDecisionEngineBackend/src/modules/data-subject/data-subject.controller.ts',
    'AtlasDecisionEngineBackend/src/modules/data-subject/data-subject.service.ts',
    'AtlasDecisionEngineFrontend/src/app/(portal)/data-subject-requests/page.next.tsx',
    'AtlasFrontend/apps/consumer-app/app/(app)/privacidad.tsx',
    'AtlasAdminPortal/src/app/internal/operations/runtime-jobs/page.tsx',
    'memoria atlas-plan-promesas-reales (frente 4: la cadena de supresión no ejecuta borrado local ni encadena al Motor)',
    'memoria atlas-motor-imagenes-persistidas (el Motor copia carnet y selfie a su MinIO)',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-11)',
  ],
  metadata: {
    gaps: [
      'Atlas sólo sabe CREAR la solicitud: no hay ruta para listarla, asignarla ni resolverla; `resolved_at`, `handled_by` y `resolution_notes` no los escribe ningún código.',
      'El portal admin no tiene cola de solicitudes del titular: /internal/governance/pii es el registro de entidades y rutas con datos personales, no una bandeja de pedidos.',
      'La solicitud de Atlas no se encadena al Motor: el Motor sólo recibe la suya si una persona la carga a mano en su portal.',
      'Los tipos no coinciden: Atlas acepta access/rectification/deletion/portability/revocation/restriction; el Motor ACCESS/PORTABILITY/ERASURE/REVIEW.',
      'El borrado no ejecuta supresión local; el Motor conserva carnet y selfie en su MinIO, segunda copia fuera del borrado.',
      'La retención de PII núcleo (pii-core-1095d) está sembrada pero no es ejecutable: espera el disparador por cierre de relación.',
    ],
  },
  stages: [
    {
      code: 'dsr_request',
      name: 'Solicitud del titular',
      description:
        'En la pantalla «Privacidad» de la app el cliente elige el derecho (ver, corregir, llevarse, limitar, retirar consentimientos o borrar la cuenta) y lo envía.',
      module: 'customer_privacy',
      actor: 'customer',
      client: 'CONSUMER_APP',
      entry: true,
      resultingStates: ['received'],
      steps: [
        {
          code: 'dsr.create_request',
          name: 'Registrar la solicitud del titular',
          description:
            'Crea la solicitud con código estable, estado `received` y vencimiento a 15 días; deja registro de acción y auditoría en la misma transacción.',
          method: 'POST',
          path: '/customers/:customerId/privacy/data-subject-requests',
          roles: ['customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin'],
          idempotencyKey: true,
          resultingStates: ['received'],
          input: {
            requestType: 'access | rectification | deletion | portability | revocation | restriction',
            description: 'string (opcional)',
          },
          output: {
            dataSubjectRequestId: 'string',
            status: 'received',
          },
          errors: ['400 X-Idempotency-Key ausente', '403 otro cliente', '404 cliente no encontrado'],
          successStatus: [201],
        },
      ],
    },
    {
      code: 'dsr_consent_revocation',
      name: 'Retiro de consentimientos',
      description:
        'Desde la misma pantalla el cliente puede revocar permisos ya dados. Una revocación marca al cliente para revisión (`requires_review`).',
      module: 'customer_privacy',
      actor: 'customer',
      client: 'CONSUMER_APP',
      optional: true,
      steps: [
        {
          code: 'dsr.consent_revocation',
          name: 'Registrar la revocación de un consentimiento',
          description:
            'Registra hasta 20 decisiones en una sola transacción; si alguna es `revoked` crea un cambio de estado del cliente a revisión.',
          method: 'POST',
          path: '/customers/:customerId/privacy/consent-decisions',
          roles: ['customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin'],
          idempotencyKey: true,
          optional: true,
          input: {
            decisions: '[{ consentDocumentId, purposeCode, decision: granted | declined | revoked }]',
          },
          errors: ['400 X-Idempotency-Key ausente', '403 otro cliente', '404 cliente no encontrado', '422 CONSENT_DOCUMENT_NOT_ACTIVE'],
          successStatus: [200],
        },
      ],
    },
    {
      code: 'dsr_internal_resolution',
      name: 'Atención interna de la solicitud',
      description:
        'Una persona de gobierno de datos debería ver la solicitud, ejecutarla y registrarla como resuelta. Hoy no hay pantalla ni ruta para hacerlo: es el hueco central del proceso.',
      module: 'customer_privacy',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      requiredStates: ['received'],
      steps: [
        {
          code: 'dsr.internal_resolution',
          name: 'Resolver la solicitud y dejar constancia',
          description:
            'Ejecutar el derecho pedido y escribir `resolved_at`, `handled_by` y `resolution_notes`. No existe ruta que lo haga ni pantalla que lo pida.',
          kind: 'manual',
          reason:
            'No hay ruta que liste ni resuelva data_subject_requests; la resolución, si ocurre, es un trabajo manual fuera del sistema y no queda registrada.',
          requiredStates: ['received'],
        },
      ],
    },
    {
      code: 'dsr_motor_decisions',
      name: 'Solicitud sobre decisiones automatizadas en el Motor',
      description:
        'Cumplimiento u operaciones cargan la solicitud en el portal del Motor con la referencia del titular; el Motor la resuelve contra su historial de decisiones (acceso y portabilidad se cumplen, borrado con decisiones se rechaza por retención legal, revisión humana queda recibida).',
      module: 'data_subject',
      actor: 'internal_user',
      client: 'MOTOR_PORTAL',
      screen: '/data-subject-requests',
      link: '{MOTOR}/data-subject-requests',
      roles: ['MOTOR:COMPLIANCE', 'MOTOR:OPERATIONS', 'MOTOR:AUDITOR'],
      resultingStates: ['RECEIVED', 'FULFILLED', 'REJECTED'],
      steps: [
        {
          code: 'dsr.motor_submit',
          name: 'Registrar y resolver la solicitud en el Motor',
          description: 'Registra la solicitud del titular y la resuelve en el acto según su tipo y el número de decisiones que coinciden.',
          system: 'DECISION_ENGINE',
          method: 'POST',
          path: '/v1/data-subject-requests',
          roles: ['COMPLIANCE', 'OPERATIONS', 'AUDITOR'],
          input: {
            subjectReference: 'string',
            requestType: 'ACCESS | PORTABILITY | ERASURE | REVIEW',
          },
          resultingStates: ['RECEIVED', 'FULFILLED', 'REJECTED'],
          successStatus: [200],
        },
        {
          code: 'dsr.motor_history',
          name: 'Consultar el historial de solicitudes del titular',
          description: 'Devuelve las solicitudes previas de la misma referencia; por POST para que la referencia no viaje en la URL.',
          system: 'DECISION_ENGINE',
          method: 'POST',
          path: '/v1/data-subject-requests/history',
          roles: ['COMPLIANCE', 'OPERATIONS', 'AUDITOR'],
          optional: true,
          successStatus: [200],
        },
      ],
    },
    {
      code: 'dsr_retention_job',
      name: 'Retención programada',
      description:
        'Tarea programada que aplica las políticas de retención activas sobre telemetría cruda (GPS, dispositivo, interacción de formularios, registros de tareas y de tráfico). Las políticas sin destino ejecutable quedan declaradas con su motivo.',
      module: 'runtime_jobs',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'dsr.retention_job',
          name: 'Aplicar políticas de retención',
          description:
            'Corre con el actor del planificador y `dryRun: false`; sólo actúa sobre tablas registradas en RETENTION_TARGETS con su fila activa en retention_policies.',
          kind: 'job',
          job: 'apply_retention_policies',
          repeatable: true,
        },
      ],
    },
    {
      code: 'dsr_retention_manual',
      name: 'Retención lanzada a mano',
      description:
        'Un administrador puede lanzar la misma retención desde la pantalla de tareas de mantenimiento del portal, por ejemplo en modo de prueba.',
      module: 'runtime_jobs',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/operations/runtime-jobs',
      optional: true,
      terminal: true,
      roles: ['admin', 'platform_admin'],
      steps: [
        {
          code: 'dsr.retention_manual',
          name: 'Lanzar la retención desde el portal',
          description: 'Ejecuta `apply_retention_policies` bajo demanda; admite `dryRun` para ver qué se purgaría.',
          method: 'POST',
          path: '/operations/jobs/apply-retention-policies',
          roles: ['admin', 'platform_admin', 'system'],
          idempotencyKey: true,
          optional: true,
          input: {
            dryRun: 'boolean',
          },
          successStatus: [200],
        },
      ],
    },
  ],
  transitions: [
    {
      code: 'dsr.entry',
      from: null,
      to: 'dsr.create_request',
      condition: 'always',
      description: 'Entrada: el cliente envía su pedido desde «Privacidad».',
      isDefault: true,
    },
    {
      code: 'dsr.request_to_revocation',
      from: 'dsr.create_request',
      to: 'dsr.consent_revocation',
      condition: 'conditional',
      expression: { requestType: 'revocation' },
      description: 'Retirar consentimientos también se ejerce revocándolos en la misma pantalla.',
    },
    {
      code: 'dsr.request_to_resolution',
      from: 'dsr.create_request',
      to: 'dsr.internal_resolution',
      condition: 'on_success',
      description: 'Registrada la solicitud, debería atenderla una persona de gobierno de datos.',
      isDefault: true,
    },
    {
      code: 'dsr.resolution_to_motor',
      from: 'dsr.internal_resolution',
      to: 'dsr.motor_submit',
      condition: 'conditional',
      expression: { touchesAutomatedDecisions: true },
      description: 'Si el pedido alcanza decisiones del Motor, se carga a mano en su portal (no hay encadenamiento automático).',
    },
    {
      code: 'dsr.motor_submit_to_history',
      from: 'dsr.motor_submit',
      to: 'dsr.motor_history',
      condition: 'on_success',
      description: 'Con la solicitud registrada, se consulta el historial del titular.',
    },
    {
      code: 'dsr.exit',
      from: 'dsr.internal_resolution',
      to: null,
      condition: 'on_success',
      description: 'Salida: solicitud resuelta y fechada.',
      isDefault: true,
    },
    {
      code: 'dsr.retention_entry',
      from: null,
      to: 'dsr.retention_job',
      condition: 'always',
      description: 'Entrada independiente: el planificador corre la retención en su intervalo.',
    },
    {
      code: 'dsr.retention_manual_entry',
      from: null,
      to: 'dsr.retention_manual',
      condition: 'conditional',
      description: 'Entrada independiente: un administrador la lanza a mano.',
    },
  ],
  dependencies: [
    {
      step: 'dsr.internal_resolution',
      dependsOn: 'dsr.create_request',
      type: 'requires_data',
      description: 'Se resuelve una solicitud que ya existe.',
    },
    {
      step: 'dsr.motor_history',
      dependsOn: 'dsr.motor_submit',
      type: 'soft',
      description: 'El historial incluye la solicitud recién registrada.',
    },
  ],
};
