/**
 * @file Catálogo de recetas: el ciclo de vida completo del cliente, del alta a la línea de crédito.
 * @business Esta pieza es la plantilla «ciclo completo» del plan: la persona se da de alta y envía
 *   su expediente, un operador QA lo revisa y decide, el riesgo se evalúa, y la persona —ya elegible—
 *   pide un crédito que el operador aprueba.
 * @system sesiones separadas por actor: la persona usa la suya y el operador QA la propia (fixture
 *   `internalActor`). Si el Motor de decisiones no decide, el caso de revisión manual lo resuelve el
 *   operador, que es lo que hace el producto; si decide, ese paso queda NOT_APPLICABLE con motivo.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { CUSTOMER_ONBOARDING_SUBMISSION } from './customer-submission.recipes.js';

const c = (suffix: string) => `/customers/{{resources.customerId}}${suffix}`;
const ops = (suffix: string) => `/operations/customers/{{resources.customerId}}${suffix}`;

const OPERATOR_REVIEW: RecipeStep[] = [
  {
    stepKey: 'ops.review_queue',
    workflowStepCode: 'lifecycle.review_queue',
    method: 'GET',
    path: '/operations/customers/pending-contact-verification',
    actor: 'internal_user',
    dependsOn: ['submission.submit'],
    expect: {
      status: [200],
      assertions: [{ kind: 'arrayContainsWhere', path: 'data.items', field: 'customerId', expected: { $ref: 'resources.customerId' } }],
    },
  },
  {
    stepKey: 'ops.evidence_documents',
    workflowStepCode: 'lifecycle.evidence_documents',
    method: 'GET',
    path: '/customer-onboarding/{{resources.customerId}}/evidence-documents',
    actor: 'internal_user',
    dependsOn: ['submission.submit'],
    expect: { status: [200] },
  },
  {
    stepKey: 'ops.investigation_summary',
    workflowStepCode: 'lifecycle.investigation_summary',
    method: 'GET',
    path: ops('/investigation-summary'),
    actor: 'internal_user',
    dependsOn: ['submission.submit'],
    expect: {
      status: [200],
      assertions: [{ kind: 'resourceOwner', path: 'data.customer.customerId', expected: { $ref: 'resources.customerId' } }],
    },
  },
  {
    stepKey: 'ops.compliance_screening',
    workflowStepCode: 'lifecycle.compliance_screening',
    method: 'POST',
    path: ops('/compliance/screening'),
    actor: 'internal_user',
    dependsOn: ['submission.submit'],
    idempotency: 'per_operation',
    body: {},
    expect: { status: [200, 201], assertions: [{ kind: 'type', path: 'data.totalMatches', type: 'number' }] },
    extract: [{ to: 'resources.complianceMatches', from: 'response.data.totalMatches', required: true }],
  },
  {
    // Sólo si el cribado encontró coincidencias: una persona sintética limpia no tiene nada que despejar.
    stepKey: 'ops.compliance_clear',
    workflowStepCode: 'lifecycle.compliance_clear',
    method: 'POST',
    path: ops('/compliance/clear-matches'),
    actor: 'internal_user',
    dependsOn: ['ops.compliance_screening'],
    applicability: {
      when: { kind: 'not', condition: { kind: 'equals', path: 'resources.complianceMatches', value: 0 } },
      reason: 'el cribado no encontró coincidencias',
    },
    idempotency: 'per_operation',
    body: { reasonCode: 'qa_false_positive', notes: 'Coincidencia descartada en QA sintético.' },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'ops.eligibility_decision',
    workflowStepCode: 'lifecycle.eligibility_decision',
    method: 'POST',
    path: ops('/eligibility/decision'),
    actor: 'internal_user',
    dependsOn: ['ops.compliance_screening'],
    idempotency: 'per_operation',
    body: { decision: 'approve', reasonCode: 'qa_review_ok', notes: 'Expediente sintético revisado en QA.' },
    expect: { status: [200, 201], assertions: [{ kind: 'equals', path: 'data.lifecycleStatus', expected: 'active' }] },
  },
  {
    stepKey: 'ops.risk_assessment',
    workflowStepCode: 'lifecycle.risk_assessment',
    method: 'POST',
    path: c('/risk-assessments'),
    actor: 'internal_user',
    dependsOn: ['ops.eligibility_decision'],
    idempotency: 'per_operation',
    body: { assessmentType: 'onboarding_initial', channel: 'operations_panel' },
    expect: { status: [200, 201], assertions: [{ kind: 'type', path: 'data.decision', type: 'string' }] },
    extract: [
      { to: 'resources.riskDecision', from: 'response.data.decision', required: true },
      { to: 'resources.manualReviewCaseId', from: 'response.data.manualReviewCaseId' },
    ],
  },
  {
    stepKey: 'ops.manual_review_decision',
    method: 'POST',
    path: '/operations/manual-review-cases/{{resources.manualReviewCaseId}}/decision',
    actor: 'internal_user',
    dependsOn: ['ops.risk_assessment'],
    applicability: { when: { kind: 'exists', path: 'resources.manualReviewCaseId' }, reason: 'el riesgo se decidió sin revisión manual' },
    idempotency: 'per_operation',
    body: { decision: 'approved', reasonCode: 'qa_manual_review_ok', notes: 'Revisión QA sintética.', nextCustomerStatus: 'active' },
    expect: { status: [200, 201], assertions: [{ kind: 'equals', path: 'data.caseStatus', expected: 'closed' }] },
  },
  {
    stepKey: 'ops.credit_rating_run',
    workflowStepCode: 'lifecycle.credit_rating_run',
    method: 'POST',
    path: '/operations/credit-rating/customers/{{resources.customerId}}/rate',
    actor: 'internal_user',
    dependsOn: ['ops.eligibility_decision'],
    idempotency: 'per_operation',
    body: {},
    expect: { status: [200, 201], assertions: [{ kind: 'type', path: 'data.customerRating.grade', type: 'string' }] },
  },
];

const CREDIT: RecipeStep[] = [
  {
    stepKey: 'life.credit_rating_read',
    workflowStepCode: 'lifecycle.credit_rating_read',
    method: 'GET',
    path: c('/credit-rating'),
    actor: 'customer',
    dependsOn: ['ops.credit_rating_run'],
    expect: { status: [200], assertions: [{ kind: 'resourceOwner', path: 'data.customerId', expected: { $ref: 'resources.customerId' } }] },
  },
  {
    // El efecto de la revisión: la persona queda elegible, sin bloqueos.
    stepKey: 'life.eligibility',
    method: 'GET',
    path: c('/eligibility'),
    actor: 'customer',
    dependsOn: ['ops.manual_review_decision', 'ops.credit_rating_run'],
    expect: { status: [200], assertions: [{ kind: 'equals', path: 'data.eligible', expected: true }] },
  },
  {
    stepKey: 'life.credit_products',
    method: 'GET',
    path: c('/credit-products'),
    actor: 'customer',
    dependsOn: ['life.eligibility'],
    expect: {
      status: [200],
      assertions: [
        { kind: 'equals', path: 'data.eligible', expected: true },
        { kind: 'arrayNonEmpty', path: 'data.products' },
      ],
    },
    extract: [{ to: 'resources.offeredProductId', from: 'response.data.products[0].productId', required: true }],
  },
  {
    stepKey: 'life.credit_apply',
    method: 'POST',
    path: c('/credit-applications'),
    actor: 'customer',
    dependsOn: ['life.credit_products'],
    idempotency: 'per_operation',
    body: {
      productId: { $ref: 'resources.offeredProductId' },
      requestedAmount: { $ref: 'persona.requestedAmount' },
      requestedTermMonths: 3,
      purposeCode: 'consumo',
    },
    expect: { status: [200, 201], assertions: [{ kind: 'exists', path: 'data.applicationId' }] },
    extract: [{ to: 'resources.applicationId', from: 'response.data.applicationId', required: true }],
  },
  {
    stepKey: 'ops.application_detail',
    workflowStepCode: 'lifecycle.application_detail',
    method: 'GET',
    path: '/operations/credit/applications/{{resources.applicationId}}',
    actor: 'internal_user',
    dependsOn: ['life.credit_apply'],
    expect: { status: [200] },
  },
  {
    stepKey: 'ops.credit_decision',
    workflowStepCode: 'lifecycle.credit_decision',
    method: 'POST',
    path: '/operations/credit/applications/{{resources.applicationId}}/decision',
    actor: 'internal_user',
    dependsOn: ['life.credit_apply'],
    idempotency: 'per_operation',
    body: { decision: 'approve', reasonCode: 'qa_credit_ok', notes: 'Solicitud sintética aprobada en QA.' },
    expect: {
      status: [200, 201],
      assertions: [
        { kind: 'equals', path: 'data.status', expected: 'approved' },
        { kind: 'equals', path: 'data.applicationId', expected: { $ref: 'resources.applicationId' } },
      ],
    },
  },
  {
    stepKey: 'life.applications_after_decision',
    method: 'GET',
    path: c('/credit-applications'),
    actor: 'customer',
    dependsOn: ['ops.credit_decision'],
    expect: {
      status: [200],
      assertions: [
        { kind: 'arrayContainsWhere', path: 'data.applications', field: 'applicationId', expected: { $ref: 'resources.applicationId' } },
      ],
    },
  },
  {
    stepKey: 'life.loans',
    workflowStepCode: 'lifecycle.loans',
    method: 'GET',
    path: c('/loans'),
    actor: 'customer',
    dependsOn: ['ops.credit_decision'],
    // Aprobar la solicitud NO desembolsa: el préstamo nace en el desembolso, que no está en este
    // recorrido. Se afirma lo que es verdad —ningún préstamo— en vez de dar por buena una lista
    // vacía como si probara algo sobre préstamos.
    expect: { status: [200], assertions: [{ kind: 'arrayLength', path: 'data.items', equals: 0 }] },
  },
  {
    stepKey: 'life.payment_calendar',
    workflowStepCode: 'lifecycle.payment_calendar',
    method: 'GET',
    path: c('/payment-calendar'),
    actor: 'customer',
    dependsOn: ['ops.credit_decision'],
    expect: {
      status: [200],
      assertions: [
        { kind: 'resourceOwner', path: 'data.customerId', expected: { $ref: 'resources.customerId' } },
        { kind: 'arrayLength', path: 'data.entries', equals: 0 },
      ],
    },
  },
];

export const CUSTOMER_FULL_LIFECYCLE_NORMAL: JourneyTemplate = {
  code: 'customer_full_lifecycle_normal',
  version: '1.0.0',
  name: 'Ciclo completo del cliente',
  description:
    'Alta completa con código real y carnet subido, revisión del operador QA (cumplimiento, elegibilidad, riesgo y ' +
    'revisión manual si hace falta), calificación, solicitud de crédito como persona elegible y decisión del operador.',
  workflowCode: 'customer_full_lifecycle',
  workflowVersion: 'v1',
  actors: ['anonymous', 'customer', 'internal_user'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal: 'Cliente activo y elegible, con una solicitud de crédito aprobada por el operador y visible en su historial.',
  status: 'READY',
  fixtures: ['consents', 'creditProduct', 'internalActor'],
  steps: [...CUSTOMER_ONBOARDING_SUBMISSION.steps, ...OPERATOR_REVIEW, ...CREDIT],
};
