/**
 * @file Catálogo de recetas: el expediente y el día a día del cliente, de la sesión al cierre.
 * @business Esta pieza prueba lo que el cliente hace entre el alta y el crédito: sesión, contacto,
 *   domicilio, perfil financiero, referencias, encuesta, consentimientos, avisos, telemetría,
 *   derechos sobre sus datos y cierre de sesión, cada lectura del cliente correcto.
 * @system cuerpos tomados de los Zod publicados en el OpenAPI y respuestas medidas contra la pila
 *   aislada el 24-sep-2026; cada escritura se comprueba después con una lectura.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { SIGNUP_STEPS } from './customer-account.recipes.js';
import { PROFILE_DOSSIER, PROFILE_SESSION_AND_CONTACT } from './customer-profile-dossier.recipes.js';

const c = (suffix: string) => `/customers/{{resources.customerId}}${suffix}`;
const o = (suffix: string) => `/customer-onboarding/{{resources.customerId}}${suffix}`;
const own = { kind: 'resourceOwner' as const, path: 'data.customerId', expected: { $ref: 'resources.customerId' } };

const SURVEY_AND_CONSENTS: RecipeStep[] = [
  {
    stepKey: 'profile.survey_get',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.survey_get',
    method: 'GET',
    path: o('/consumer-survey'),
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'equals', path: 'data.complete', expected: false }] },
  },
  {
    stepKey: 'profile.survey_put',
    dependsOn: ['profile.survey_get'],
    workflowStepCode: 'lifecycle.survey_put',
    method: 'PUT',
    path: o('/consumer-survey'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: {
      surveyVersion: 'habitos-v1',
      answers: [
        { questionCode: 'gasto_fijo', answerCode: '25_50', answeredInMs: 4200 },
        { questionCode: 'dependientes', answerCode: '1', answeredInMs: 3100 },
        { questionCode: 'ahorro', answerCode: 'ahorro', answeredInMs: 3900 },
        { questionCode: 'imprevisto', answerCode: 'ahorros', answeredInMs: 4600 },
        { questionCode: 'cuota_maxima', answerValue: 800, answeredInMs: 6100 },
        { questionCode: 'frecuencia', answerCode: 'mensual', answeredInMs: 2800 },
      ],
    },
    expect: { status: [200] },
  },
  {
    stepKey: 'profile.survey_effect',
    dependsOn: ['profile.survey_put'],
    method: 'GET',
    path: o('/consumer-survey'),
    actor: 'customer',
    expect: {
      status: [200],
      assertions: [
        { kind: 'equals', path: 'data.complete', expected: true },
        { kind: 'arrayLength', path: 'data.missing', equals: 0 },
      ],
    },
  },
  {
    stepKey: 'profile.consent_decisions',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.consent_decisions',
    method: 'POST',
    path: c('/privacy/consent-decisions'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: {
      decisions: [
        {
          consentDocumentId: { $ref: 'fixtures.signupConsents[0].consentDocumentId' },
          purposeCode: { $ref: 'fixtures.signupConsents[0].purposeCode' },
          decision: 'granted',
        },
      ],
    },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'profile.external_features',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.external_features',
    method: 'GET',
    path: '/external-data/users/{{resources.customerId}}/features',
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data', type: 'array' }] },
  },
  {
    stepKey: 'profile.workflow_progress',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.workflow_progress',
    method: 'GET',
    path: c('/workflow-progress'),
    actor: 'customer',
    expect: { status: [200], assertions: [own, { kind: 'type', path: 'data.completionPercentage', type: 'number' }] },
  },
];

const MONEY_AND_ENGAGEMENT: RecipeStep[] = [
  {
    // Sin evaluación no hay línea: el 404 con su motivo es el desenlace correcto, no un fallo.
    stepKey: 'profile.credit_line',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.credit_line',
    method: 'GET',
    path: c('/credit-line'),
    actor: 'customer',
    expect: { status: [404], assertions: [{ kind: 'equals', path: 'error.message', expected: 'CREDIT_LINE_NOT_CALCULATED' }] },
  },
  {
    stepKey: 'profile.credit_line_history',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.credit_line_history',
    method: 'GET',
    path: c('/credit-line/history'),
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'arrayLength', path: 'data.items', equals: 0 }] },
  },
  {
    stepKey: 'profile.spending_by_category',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.spending_by_category',
    method: 'GET',
    path: c('/spending-by-category'),
    actor: 'customer',
    expect: { status: [200], assertions: [own, { kind: 'equals', path: 'data.totals.loanCount', expected: 0 }] },
  },
  {
    stepKey: 'profile.device_token',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.device_token',
    method: 'POST',
    path: c('/device-tokens'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { platform: 'android', token: 'qa-push-{{persona.personaKey}}-{{run.nonce}}', deviceId: { $ref: 'resources.deviceId' } },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'profile.notification_preferences',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.notification_preferences',
    method: 'PATCH',
    path: c('/notification-preferences'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { preferences: [{ eventCode: 'limite_actualizado', channel: 'push', isEnabled: false, isRequired: false }] },
    expect: { status: [200] },
  },
  {
    stepKey: 'profile.notifications',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.notifications',
    method: 'GET',
    path: c('/notifications'),
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.data', type: 'array' }] },
  },
  {
    stepKey: 'profile.telemetry',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.telemetry',
    method: 'POST',
    path: c('/telemetry/batch'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: {
      sessionId: { $ref: 'resources.sessionId' },
      deviceId: { $ref: 'resources.deviceId' },
      clientBatchId: 'qa-{{persona.personaKey}}-{{run.nonce}}',
      capturedFrom: { $ref: 'run.nowIso' },
      capturedUntil: { $ref: 'run.nowIso' },
      events: [
        { eventType: 'customer_action', eventCode: 'qa_screen_view', occurredAt: { $ref: 'run.nowIso' }, metadata: { screen: 'home' } },
      ],
    },
    expect: { status: [200, 202] },
  },
  {
    stepKey: 'profile.session_heartbeat',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.session_heartbeat',
    method: 'POST',
    path: c('/sessions/{{resources.sessionId}}/heartbeat'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: {
      deviceId: { $ref: 'resources.deviceId' },
      clientHeartbeatId: 'hb-{{persona.personaKey}}-{{run.nonce}}',
      capturedAt: { $ref: 'run.nowIso' },
    },
    expect: { status: [200, 202] },
  },
];

const EXIT: RecipeStep[] = [
  {
    stepKey: 'profile.data_subject_request',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.data_subject_request',
    method: 'POST',
    path: c('/privacy/data-subject-requests'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { requestType: 'access' },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'profile.session_end',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.session_end',
    method: 'POST',
    path: c('/sessions/{{resources.sessionId}}/end'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { deviceId: { $ref: 'resources.deviceId' }, endedAt: { $ref: 'run.nowIso' }, reasonCode: 'customer_logout' },
    expect: { status: [200] },
  },
  {
    stepKey: 'profile.logout',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.logout',
    method: 'POST',
    path: '/auth/logout',
    actor: 'customer',
    idempotency: 'per_operation',
    body: { refreshToken: { $ref: 'session.customer.refreshToken' }, allDevices: false },
    expect: { status: [200, 201] },
  },
  {
    // El cierre tiene que cerrar: con el refresh revocado, renovar la sesión ya no es posible.
    stepKey: 'profile.refresh_after_logout',
    dependsOn: ['profile.logout'],
    method: 'POST',
    path: '/auth/refresh',
    actor: 'anonymous',
    body: { refreshToken: { $ref: 'session.customer.refreshToken' } },
    expect: { status: [401] },
  },
];

export const CUSTOMER_PROFILE_LIFECYCLE: JourneyTemplate = {
  code: 'customer_profile_lifecycle',
  version: '1.0.0',
  name: 'Expediente y día a día del cliente',
  description:
    'Alta propia y, con esa sesión: canales, sesión de app, contacto, domicilio, ubicación, perfil financiero, referencias, ' +
    'encuesta, consentimientos, línea y gastos, avisos, telemetría, derechos sobre sus datos y cierre de sesión.',
  workflowCode: 'customer_full_lifecycle',
  workflowVersion: 'v1',
  actors: ['anonymous', 'customer'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal: 'Expediente con domicilio, perfil, referencias y encuesta completos; sesión cerrada y refresh revocado.',
  status: 'READY',
  fixtures: ['consents'],
  steps: [...SIGNUP_STEPS, ...PROFILE_SESSION_AND_CONTACT, ...PROFILE_DOSSIER, ...SURVEY_AND_CONSENTS, ...MONEY_AND_ENGAGEMENT, ...EXIT],
};
