/**
 * @file Proceso declarado en código: Elegibilidad y ciclo de vida del cliente.
 * @business Sólo un cliente `active` y sin bloqueadores puede pedir crédito: este proceso decide y deja evidencia de cuándo un cliente pasa a activo, observado, suspendido, rechazado o bloqueado, y por qué.
 * @system fixture que `syncWorkflowCatalog` vuelca a `workflow_*`; escrita el 2026-09-26 desde `customers/` (máquina de estados y regla eligibility-v2 desde el 2026-09-28), `operations/` y `fraud/`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

const ELIGIBILITY_DECIDERS = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin'];
const OPERATIONS_READERS = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin'];

export const CUSTOMER_ELIGIBILITY_LIFECYCLE: WorkflowDefinitionFixture = {
  processId: 'P-05',
  code: 'customer_eligibility_lifecycle',
  version: 'v1',
  name: 'Elegibilidad y ciclo de vida del cliente',
  description:
    'Cálculo de la habilitación crediticia con la regla eligibility-v2 (las condiciones C1–C15 salvo las referencias, que dejaron de exigirse; lista completa de bloqueadores) y transiciones del estado del cliente por la máquina de estados: promoción automática desde under_review, decisión administrativa y decisiones de casos de revisión.',
  processType: 'back_office',
  ownerDomain: 'customers',
  ownerRole: 'OPERATIONS_MANAGER',
  priority: 'P1',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'La habilitación no es una bandera que cualquiera escribe: se calcula con quince condiciones verificables y cada cálculo deja una fila de evidencia con la versión de la regla. Así se puede contestar «por qué se habilitó a este cliente tal día» con un dato, y ningún servicio puede saltarse la máquina de estados.',
    whoStartsAndCloses:
      'Lo inicia el sistema al reevaluar (envío del alta, resolución de riesgo o identidad, cada consulta de habilitación de la app) o una persona interna con una decisión administrativa. Lo cierra la promoción automática a active cuando sólo falta el estado, o la decisión de un analista (aprobar, rechazar, observar, suspender, reincorporar).',
    startAndEnd:
      'Empieza con un cliente en under_review que ya envió su alta. Termina cuando lifecycle_status queda en active (único estado que habilita crédito), observed, rejected, suspended o blocked, con su fila en customer_status_events y una evaluación en customer_eligibility_evaluations con decision_source automatic, manual_decision o manual_override.',
    whenItFails:
      'Una transición ilegal responde 422 INVALID_STATUS_TRANSITION y no se fuerza. Si falta cualquier condición el cliente sigue en under_review con sus bloqueadores a la vista en la app. El cliente no se entera del cambio: los eventos customer.lifecycle.* se escriben en el outbox y están registrados (los consume process_events), pero no tienen canal de aviso.',
    healthIndicator:
      'Tiempo desde el envío del alta hasta active o rejected, número de clientes en under_review con sólo ACCOUNT_NOT_ACTIVE pendiente (deberían promocionarse solos) y proporción de aprobaciones con decision_source manual_override en customer_eligibility_evaluations.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'customer',
    table: 'customers',
    idColumn: '_id',
    statusColumn: 'lifecycle_status',
    labelColumn: 'customer_code',
    openStatuses: ['under_review', 'observed', 'suspended'],
  },
  success: 'El cliente queda active y elegible (eligible = true, sin bloqueadores) con la evidencia de la evaluación registrada.',
  failure: 'El cliente queda rejected, blocked u observed, o atascado en under_review con bloqueadores que nadie resuelve.',
  sources: [
    'src/modules/customers/customer-eligibility.constants.ts',
    'src/modules/customers/customer-eligibility.controller.ts',
    'src/modules/customers/application/customer-eligibility.service.ts',
    'src/modules/customers/application/customer-eligibility.evaluator.ts',
    'src/modules/customers/application/customer-eligibility-decision.service.ts',
    'src/modules/customers/application/customer-lifecycle.service.ts',
    'src/modules/customers/repositories/customer-lifecycle.repository.ts',
    'src/modules/customers/customers.controller.ts',
    'src/modules/operations/operations.controller.ts',
    'src/modules/operations/operations.service.ts',
    'src/modules/fraud/fraud.service.ts',
    'src/modules/fraud/fraud.schemas.ts',
    'docs/architecture/onboarding-flujo-corregido.md',
    'AtlasAdminPortal/src/features/operations-cases/work-queue-page.tsx',
    'AtlasAdminPortal/src/features/operations-cases/manual-review-decision-form.tsx',
    'AtlasFrontend/apps/consumer-app/src/api/endpoints/customer.ts',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/cableado.json',
  ],
  metadata: {
    comesFrom: ['P-02 customer_onboarding_kyc (envío)', 'P-03 identity_verification', 'P-04 onboarding_risk_assessment'],
    ruleVersion: 'eligibility-v2',
  },
  stages: [
    {
      code: 'eligibility_evaluation',
      name: 'Evaluación de la regla de habilitación',
      description:
        'Las condiciones C1–C15 menos las referencias (eligibility-v2); la regla nunca corta en el primer bloqueador. Sólo desde under_review y con ACCOUNT_NOT_ACTIVE como único bloqueador promueve a active sola.',
      module: 'customers',
      actor: 'system',
      client: 'BLOCK',
      entry: true,
      requiredStates: ['under_review'],
      resultingStates: ['active'],
      completionRule: { type: 'no_blockers' },
      steps: [
        {
          code: 'eligibility.reevaluate',
          name: 'Reevaluar y registrar la habilitación',
          description:
            'evaluateAndRecord corre dentro de la transacción del envío del alta, de la decisión de identidad y del aviso de riesgo del Motor; puede promover a active.',
          kind: 'event',
          reason:
            'La reevaluación la invocan otros casos de uso en su propia transacción (CustomerEligibilityService); no es una llamada HTTP.',
          resultingStates: ['active'],
          events: ['customer.lifecycle.active'],
        },
      ],
    },
    {
      code: 'eligibility_customer_view',
      name: 'El cliente consulta su habilitación',
      description:
        'La app lee la habilitación y los bloqueadores para decidir si muestra «Solicitar crédito». Cada consulta deja evidencia.',
      module: 'customers',
      actor: 'customer',
      client: 'CONSUMER_APP',
      steps: [
        {
          code: 'eligibility.get',
          name: 'Consultar la habilitación',
          description: 'Devuelve eligible, blockers, sections, completionPercentage y nextStep; un customer sólo ve la suya.',
          method: 'GET',
          path: '/customers/:customerId/eligibility',
          roles: ['customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin'],
          repeatable: true,
          errors: ['403 otro cliente', '404 cliente no encontrado'],
        },
        {
          code: 'eligibility.me',
          name: 'Leer el perfil y estado del cliente',
          description: 'Resumen del cliente con su estado de ciclo de vida.',
          method: 'GET',
          path: '/customers/:customerId/me',
          roles: ['customer', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin'],
          repeatable: true,
        },
      ],
    },
    {
      code: 'eligibility_case_decisions',
      name: 'Decisiones de casos que mueven el estado',
      description:
        'Desde la cola de trabajo, la decisión de un caso de revisión manual puede llevar al cliente a otro estado (nextCustomerStatus) pasando por la máquina de estados.',
      module: 'operations',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/operations/work-queue',
      optional: true,
      roles: OPERATIONS_READERS,
      steps: [
        {
          code: 'eligibility.ops_work_queue',
          name: 'Ver la cola de trabajo',
          description: 'Cola combinada de revisión manual y fraude.',
          method: 'GET',
          path: '/operations/work-queue',
          roles: OPERATIONS_READERS,
        },
        {
          code: 'eligibility.ops_manual_decision',
          name: 'Decidir un caso de revisión manual con cambio de estado',
          description:
            'Con nextCustomerStatus (active, observed, under_review, rejected, blocked o suspended) aplica la transición y su historial.',
          method: 'POST',
          path: '/operations/manual-review-cases/:caseId/decision',
          roles: ['internal_operator', 'risk_analyst', 'admin', 'platform_admin'],
          idempotencyKey: true,
          optional: true,
          errors: ['409 CASE_ALREADY_CLOSED', '409 MANUAL_REVIEW_DELEGADA_AL_MOTOR', '422 INVALID_STATUS_TRANSITION'],
        },
        {
          code: 'eligibility.ops_fraud_decision',
          name: 'Decidir un caso de fraude',
          description:
            'Con nextCustomerStatus escribe una fila de historial, pero NO cambia customers.lifecycle_status y usa valores heredados (blocked, pending_fraud_review, registered, approved_for_next_step).',
          method: 'POST',
          path: '/operations/fraud-cases/:caseId/decision',
          roles: ['fraud_analyst', 'admin', 'platform_admin'],
          optional: true,
        },
      ],
    },
    {
      code: 'eligibility_admin_decision',
      name: 'Decisión administrativa de habilitación',
      description:
        'Aprobar, rechazar, observar, suspender o reincorporar. Toda decisión negativa exige nota; aprobar con bloqueadores queda como excepción (manual_override). Sin pantalla en el portal hoy.',
      module: 'customers',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/operations/customers/[customerId]/investigation-summary',
      optional: true,
      roles: ELIGIBILITY_DECIDERS,
      requiredStates: ['under_review', 'observed', 'active', 'suspended', 'rejected', 'blocked'],
      resultingStates: ['active', 'rejected', 'observed', 'suspended', 'under_review'],
      steps: [
        {
          code: 'eligibility.ops_decision',
          name: 'Decidir la habilitación',
          description: 'approve→active, reject→rejected, observe→observed, suspend→suspended, reinstate→under_review.',
          method: 'POST',
          path: '/operations/customers/:customerId/eligibility/decision',
          roles: ELIGIBILITY_DECIDERS,
          input: {
            decision: 'approve | reject | observe | suspend | reinstate',
            reasonCode: 'string',
            notes: 'string (obligatoria salvo approve/reinstate)',
          },
          errors: ['404 cliente no encontrado', '422 INVALID_STATUS_TRANSITION'],
          events: [
            'customer.lifecycle.active',
            'customer.lifecycle.rejected',
            'customer.lifecycle.observed',
            'customer.lifecycle.suspended',
          ],
        },
      ],
    },
    {
      code: 'eligibility_lifecycle_event',
      name: 'Evento de la transición',
      description:
        'Cada transición escribe customer.lifecycle.<estado> en el outbox en la misma transacción. Está registrado (familia customer_lifecycle) y lo consume process_events, pero sin canal de notificación: se procesa sin avisar a nadie.',
      module: 'customers',
      actor: 'system',
      client: 'BLOCK',
      terminal: true,
      steps: [
        {
          code: 'eligibility.lifecycle_outbox',
          name: 'Escribir el evento de ciclo de vida',
          description: 'Fila en outbox_events con estado anterior, nuevo y motivo; ningún canal de notificación la consume.',
          kind: 'event',
          reason: 'Lo escribe CustomerLifecycleRepository en la transacción del cambio de estado; no hay llamada HTTP.',
          events: ['customer.lifecycle.active'],
        },
      ],
    },
  ],
  transitions: [
    {
      code: 'eligibility.entry',
      from: null,
      to: 'eligibility.reevaluate',
      condition: 'always',
      description: 'Llega un cliente en under_review.',
      isDefault: true,
    },
    {
      code: 'eligibility.auto_active',
      from: 'eligibility.reevaluate',
      to: 'eligibility.lifecycle_outbox',
      condition: 'conditional',
      expression: { onlyBlocker: 'ACCOUNT_NOT_ACTIVE', lifecycleStatus: 'under_review' },
      description: 'Promoción automática a active.',
      isDefault: true,
    },
    {
      code: 'eligibility.blocked_to_queue',
      from: 'eligibility.reevaluate',
      to: 'eligibility.ops_work_queue',
      condition: 'conditional',
      expression: { hasBlockers: true },
      description: 'Con bloqueadores, el caso espera una decisión humana.',
    },
    {
      code: 'eligibility.queue_to_decision',
      from: 'eligibility.ops_work_queue',
      to: 'eligibility.ops_manual_decision',
      condition: 'on_success',
    },
    {
      code: 'eligibility.manual_to_event',
      from: 'eligibility.ops_manual_decision',
      to: 'eligibility.lifecycle_outbox',
      condition: 'on_success',
    },
    { code: 'eligibility.admin_to_event', from: 'eligibility.ops_decision', to: 'eligibility.lifecycle_outbox', condition: 'on_success' },
    {
      code: 'eligibility.customer_reads',
      from: 'eligibility.lifecycle_outbox',
      to: 'eligibility.get',
      condition: 'always',
      description: 'El cliente descubre el cambio sólo al volver a consultar su habilitación.',
      isDefault: true,
    },
    { code: 'eligibility.exit', from: 'eligibility.get', to: null, condition: 'on_success', isDefault: true },
  ],
  dependencies: [
    {
      step: 'eligibility.ops_manual_decision',
      dependsOn: 'eligibility.ops_work_queue',
      type: 'soft',
      description: 'El caso se elige en la cola.',
    },
    { step: 'eligibility.lifecycle_outbox', dependsOn: 'eligibility.reevaluate', type: 'soft' },
  ],
};
