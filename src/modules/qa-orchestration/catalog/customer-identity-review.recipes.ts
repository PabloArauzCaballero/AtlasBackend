/**
 * @file Catálogo de recetas: la identidad que SEGIP no confirma y que resuelve un operador.
 * @business Esta pieza prueba el camino que no es feliz: el registro estatal pide revisión manual,
 *   la identidad queda pendiente y un operador QA la aprueba con motivo; el efecto se ve en la persona.
 * @system escenario `manual_review_required` del mock de SEGIP; la subida del carnet y la selfie son
 *   las mismas del alta completa. La decisión la firma el operador QA con su propia sesión.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { SIGNUP_STEPS } from './customer-account.recipes.js';
import { IDENTITY_STEPS } from './customer-submission.recipes.js';

/** El paquete de identidad, pero afirmando la revisión pendiente en vez de la verificación. */
const UNDER_REVIEW: RecipeStep[] = IDENTITY_STEPS.filter((step) => step.stepKey !== 'submission.identity_verification').map((step) =>
  step.stepKey === 'submission.identity_package'
    ? {
        ...step,
        expect: {
          status: [200, 201, 202],
          assertions: [{ kind: 'equals', path: 'data.verification.identityVerificationResult', expected: 'pending_review' }],
        },
        branches: undefined,
      }
    : step,
);

const DECISION: RecipeStep[] = [
  {
    stepKey: 'identity.operator_decision',
    workflowStepCode: 'lifecycle.identity_decision',
    method: 'POST',
    path: '/operations/customers/{{resources.customerId}}/identity-verification/decision',
    actor: 'internal_user',
    dependsOn: ['submission.identity_package'],
    idempotency: 'per_operation',
    body: { decision: 'approve', reasonCode: 'qa_identity_manual_ok', notes: 'Identidad sintética revisada a mano en QA.' },
    expect: {
      status: [200, 201],
      assertions: [
        { kind: 'equals', path: 'data.identityVerificationResult', expected: 'verified' },
        { kind: 'resourceOwner', path: 'data.customerId', expected: { $ref: 'resources.customerId' } },
      ],
    },
  },
  {
    // El efecto de la decisión, visto por la persona: su identidad deja de estar pendiente.
    stepKey: 'identity.status_after_decision',
    method: 'GET',
    path: '/customer-onboarding/{{resources.customerId}}/status',
    actor: 'customer',
    dependsOn: ['identity.operator_decision'],
    // El resto del expediente sigue pendiente a propósito: esta plantilla sólo prueba la identidad.
    expect: {
      status: [200],
      assertions: [{ kind: 'arrayContainsWhere', path: 'data.sections', field: 'code', expected: 'identity_documents' }],
    },
  },
];

export const CUSTOMER_IDENTITY_MANUAL_REVIEW: JourneyTemplate = {
  code: 'customer_identity_manual_review',
  version: '1.0.0',
  name: 'Identidad en revisión manual',
  description:
    'Alta propia, carnet y selfie subidos, SEGIP pide revisión manual (escenario del mock) y el operador QA aprueba ' +
    'la identidad con motivo; la persona ve el resultado.',
  workflowCode: 'customer_full_lifecycle',
  workflowVersion: 'v1',
  actors: ['anonymous', 'customer', 'internal_user'],
  scenarios: ['manual_review_required'],
  defaultScenario: 'manual_review_required',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal: 'Identidad aprobada por el operador tras la revisión manual que pidió el registro estatal.',
  status: 'READY',
  fixtures: ['consents', 'internalActor'],
  steps: [...SIGNUP_STEPS, ...UNDER_REVIEW, ...DECISION],
};
