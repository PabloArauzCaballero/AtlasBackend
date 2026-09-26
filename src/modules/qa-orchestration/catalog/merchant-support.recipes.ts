/**
 * @file Catálogo de recetas: el comercio pide ayuda y el operador gobierna su acceso.
 * @business Esta pieza prueba el soporte del lado del comercio —preguntas frecuentes, categorías,
 *   abrir un caso, verlo, pedir su cierre y valorar la atención— y que el operador puede suspender
 *   y reactivar al usuario de comercio.
 * @system no necesita al Motor: el comercio abre el caso sobre su expediente en borrador. El usuario
 *   de comercio lo provisiona el operador QA dentro de la receta, como en el alta completa.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { PARTNER_DOSSIER_STEPS } from './partner-dossier.recipes.js';
import { MERCHANT_PROVISIONING_STEPS } from './partner-onboarding.recipes.js';

const PARTNER_START = PARTNER_DOSSIER_STEPS.filter((step) => step.stepKey === 'partner.start');

const SUPPORT: RecipeStep[] = [
  {
    stepKey: 'support.faq',
    workflowStepCode: 'support.faq',
    method: 'GET',
    path: '/merchant/support/faq',
    actor: 'merchant_user',
    dependsOn: ['merchant.login'],
    expect: { status: [200] },
  },
  {
    stepKey: 'support.categories',
    workflowStepCode: 'support.categories',
    method: 'GET',
    path: '/merchant/support/categories',
    actor: 'merchant_user',
    dependsOn: ['merchant.login'],
    // El comercio en alta pregunta por su alta: esa categoría tiene que estar en su catálogo.
    expect: {
      status: [200],
      assertions: [{ kind: 'arrayContainsWhere', path: 'data.categories', field: 'categoryCode', expected: 'PARTNER_ONBOARDING' }],
    },
  },
  {
    stepKey: 'support.case_create',
    workflowStepCode: 'support.case_create',
    method: 'POST',
    path: '/merchant/support/cases',
    actor: 'merchant_user',
    dependsOn: ['support.categories', 'partner.start'],
    idempotency: 'per_operation',
    body: {
      categoryCode: 'PARTNER_ONBOARDING',
      title: 'Consulta sintética de QA {{persona.personaKey}}',
      description: 'Caso abierto por una persona sintética en una corrida QA. No requiere atención real.',
      partnerProfileId: { $ref: 'resources.partnerId' },
      acknowledgeDuplicate: true,
    },
    expect: { status: [200, 201], assertions: [{ kind: 'exists', path: 'data.caseId' }] },
    extract: [
      { to: 'resources.supportCaseId', from: 'response.data.caseId', required: true },
      { to: 'resources.supportChannelId', from: 'response.data.channelId', required: true },
    ],
  },
  {
    stepKey: 'support.case_detail',
    workflowStepCode: 'support.case_detail',
    method: 'GET',
    path: '/merchant/support/cases/{{resources.supportCaseId}}',
    actor: 'merchant_user',
    expect: { status: [200], assertions: [{ kind: 'resourceOwner', path: 'data.caseId', expected: { $ref: 'resources.supportCaseId' } }] },
  },
  {
    stepKey: 'support.operator_claim',
    method: 'POST',
    path: '/internal/support/cases/{{resources.supportCaseId}}/claim',
    actor: 'internal_user',
    idempotency: 'per_operation',
    body: { reason: 'Lo toma el operador QA.' },
    expect: { status: [200] },
  },
  {
    // Contestarle al comercio es trabajar el caso: lo pasa a IN_PROGRESS y fija la primera respuesta.
    stepKey: 'support.operator_reply',
    method: 'POST',
    path: '/support/channels/{{resources.supportChannelId}}/messages',
    actor: 'internal_user',
    idempotency: 'per_operation',
    body: {
      clientMessageId: 'qa-{{run.nonce}}-{{persona.personaKey}}',
      body: 'Hola, soy el operador QA: tu consulta sintética está atendida.',
    },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'support.case_close_request',
    workflowStepCode: 'support.case_close_request',
    method: 'POST',
    path: '/merchant/support/cases/{{resources.supportCaseId}}/close-request',
    actor: 'merchant_user',
    idempotency: 'per_operation',
    body: { reason: 'Consulta resuelta en la corrida QA.' },
    expect: { status: [200, 201] },
  },
  {
    // Sólo se valora una atención terminada: el operador QA documenta la solución y la comunica.
    stepKey: 'support.operator_resolve',
    method: 'POST',
    path: '/internal/support/cases/{{resources.supportCaseId}}/resolve',
    actor: 'internal_user',
    idempotency: 'per_operation',
    body: {
      resolutionCode: 'ANSWERED',
      rootCauseCode: 'USER_MISUNDERSTANDING',
      customerResolution: 'Respondimos tu consulta sintética de QA.',
      internalResolution: 'Caso sintético de una corrida QA, resuelto por el operador QA.',
    },
    expect: { status: [200] },
  },
  {
    stepKey: 'support.case_feedback',
    workflowStepCode: 'support.case_feedback',
    method: 'POST',
    path: '/merchant/support/cases/{{resources.supportCaseId}}/feedback',
    actor: 'merchant_user',
    idempotency: 'per_operation',
    body: { csatScore: 5, effortScore: 2, comment: 'Valoración sintética de QA.' },
    expect: { status: [200, 201] },
  },
];

const ACCESS: RecipeStep[] = [
  {
    stepKey: 'merchant.user_suspend',
    workflowStepCode: 'merchant.user_status',
    method: 'PATCH',
    path: '/merchant/users/{{resources.merchantUserId}}/status',
    actor: 'internal_user',
    dependsOn: ['support.case_feedback'],
    idempotency: 'per_operation',
    body: { status: 'suspended', reason: 'Suspensión de prueba en la corrida QA.' },
    expect: { status: [200], assertions: [{ kind: 'equals', path: 'data.status', expected: 'suspended' }] },
  },
  {
    // Suspendido, el comercio no entra: es el efecto que la suspensión promete.
    stepKey: 'merchant.login_while_suspended',
    method: 'POST',
    path: '/merchant/auth/login',
    actor: 'anonymous',
    rateLimit: { bucket: 'merchant_login', perMinute: 10 },
    body: { tenantId: '1', email: { $ref: 'persona.email' }, password: { $ref: 'session.merchant_user.password' } },
    expect: { status: [401, 403] },
  },
  {
    stepKey: 'merchant.user_reactivate',
    method: 'PATCH',
    path: '/merchant/users/{{resources.merchantUserId}}/status',
    actor: 'internal_user',
    idempotency: 'per_operation',
    body: { status: 'active', reason: 'Reactivación tras la prueba de suspensión QA.' },
    expect: { status: [200], assertions: [{ kind: 'equals', path: 'data.status', expected: 'active' }] },
  },
];

export const MERCHANT_SUPPORT_AND_ACCESS: JourneyTemplate = {
  code: 'merchant_support_and_access',
  version: '1.0.0',
  name: 'Soporte del comercio y control de su acceso',
  description:
    'El operador provisiona al usuario de comercio; el comercio consulta ayuda, abre un caso, lo ve, pide su cierre y ' +
    'valora la atención; el operador lo suspende (y el comercio ya no entra) y lo reactiva.',
  workflowCode: 'customer_partner_commerce',
  workflowVersion: 'v1',
  actors: ['anonymous', 'internal_user', 'merchant_user'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal: 'Caso de soporte abierto, con cierre pedido y valoración; el usuario de comercio vuelve a estar activo.',
  status: 'READY',
  fixtures: ['internalActor'],
  steps: [...MERCHANT_PROVISIONING_STEPS, ...PARTNER_START, ...SUPPORT, ...ACCESS],
};
