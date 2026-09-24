/**
 * @file Catálogo de recetas: alta, login y primera pantalla del cliente.
 * @business Esta pieza deja listos, sin editar JSON ni buscar IDs, los recorridos de cuenta que el
 *   laboratorio QA ofrece por defecto.
 * @system recetas declarativas portadas de `scripts/qa/journeys.ts`, cuyos cuerpos y respuestas se
 *   comprobaron contra el servicio corriendo (no contra la semilla del catálogo, que diverge).
 *
 * Divergencia conocida que manda aquí: el `input_contract_json` de la semilla de `signup.start`
 * dice `{email, phone, channel, documentNumber}` y el Zod real exige `{customer, password,
 * consents, device}` más `X-Idempotency-Key`. Manda el Zod.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';

const customerPath = (suffix: string) => `/customers/{{resources.customerId}}${suffix}`;

/** Pasos del alta. Se reutilizan como prefijo en toda plantilla que necesita un cliente propio. */
export const SIGNUP_STEPS: RecipeStep[] = [
  {
    stepKey: 'signup.consent_documents',
    workflowStepCode: 'lifecycle.consent_documents',
    method: 'GET',
    path: '/consent-documents/active',
    actor: 'anonymous',
    dependsOn: [],
    expect: { status: [200], assertions: [{ kind: 'arrayNonEmpty', path: 'data' }] },
    retry: { maxAttempts: 2 },
  },
  {
    stepKey: 'signup.start',
    workflowStepCode: 'lifecycle.signup',
    method: 'POST',
    path: '/customer-onboarding/start',
    actor: 'anonymous',
    // 10 por minuto y por IP, declarado en el controlador contra la enumeración. Se respeta.
    rateLimit: { bucket: 'onboarding_start', perMinute: 10 },
    idempotency: 'per_operation',
    body: {
      customer: {
        email: { $ref: 'persona.email' },
        phone: { $ref: 'persona.phone' },
        firstName: { $ref: 'persona.firstName' },
        lastName: { $ref: 'persona.lastName' },
        birthDate: { $ref: 'persona.birthDate' },
      },
      password: { $ref: 'persona.pin' },
      consents: { $ref: 'fixtures.signupConsents' },
      device: { deviceFingerprintHash: { $ref: 'persona.deviceFingerprintHash' }, fingerprintVersion: 'v1', channel: 'mobile_app' },
    },
    expect: {
      status: [200, 201],
      assertions: [
        { kind: 'type', path: 'data.customerId', type: 'string' },
        { kind: 'equals', path: 'data.lifecycleStatus', expected: 'registered' },
        { kind: 'type', path: 'data.tokens', type: 'object' },
      ],
    },
    extract: [
      { to: 'resources.customerId', from: 'response.data.customerId', required: true },
      { to: 'resources.sessionId', from: 'response.data.sessionId' },
      { to: 'resources.deviceId', from: 'response.data.deviceId' },
      { to: 'session.customer.accessToken', from: 'response.data.tokens.accessToken', required: true },
      { to: 'session.customer.refreshToken', from: 'response.data.tokens.refreshToken' },
    ],
  },
  {
    stepKey: 'signup.login',
    workflowStepCode: 'lifecycle.login',
    method: 'POST',
    path: '/auth/login',
    actor: 'anonymous',
    rateLimit: { bucket: 'auth_login', perMinute: 10 },
    body: { actorType: 'customer', identifier: { $ref: 'persona.email' }, password: { $ref: 'persona.pin' } },
    expect: { status: [200, 201], assertions: [{ kind: 'type', path: 'data.accessToken', type: 'string' }] },
    extract: [
      { to: 'session.customer.accessToken', from: 'response.data.accessToken', required: true },
      { to: 'session.customer.refreshToken', from: 'response.data.refreshToken' },
    ],
  },
  {
    stepKey: 'signup.me',
    workflowStepCode: 'lifecycle.auth_me',
    method: 'GET',
    path: '/auth/me',
    actor: 'customer',
    // El oráculo no es «respondió 200»: es que la sesión sea DE ESTA PERSONA.
    expect: { status: [200], assertions: [{ kind: 'resourceOwner', path: 'data.customerId', expected: { $ref: 'resources.customerId' } }] },
  },
];

/** Primera pantalla tras el login: lecturas coherentes entre sí y del cliente correcto. */
export const FIRST_SCREEN_STEPS: RecipeStep[] = [
  {
    stepKey: 'first_screen.customer_me',
    method: 'GET',
    path: customerPath('/me'),
    actor: 'customer',
    expect: {
      status: [200],
      assertions: [{ kind: 'resourceOwner', path: 'data.customer.customerId', expected: { $ref: 'resources.customerId' } }],
    },
  },
  {
    stepKey: 'first_screen.onboarding_status',
    workflowStepCode: 'lifecycle.status',
    method: 'GET',
    path: '/customer-onboarding/{{resources.customerId}}/status',
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.lifecycleStatus', type: 'string' }] },
    extract: [{ to: 'resources.lifecycleStatus', from: 'response.data.lifecycleStatus' }],
  },
  {
    stepKey: 'first_screen.session_state',
    method: 'GET',
    path: customerPath('/session-state'),
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'exists', path: 'data.activeSession' }] },
  },
  {
    stepKey: 'first_screen.observations',
    workflowStepCode: 'lifecycle.observations',
    method: 'GET',
    path: '/customer-onboarding/{{resources.customerId}}/observations',
    actor: 'customer',
    expect: { status: [200] },
  },
  {
    stepKey: 'first_screen.eligibility',
    workflowStepCode: 'lifecycle.eligibility',
    method: 'GET',
    path: customerPath('/eligibility'),
    actor: 'customer',
    // Se comprueba la FORMA del veredicto, no su valor: imponer `eligible: true` sería imponerle
    // el resultado al backend.
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.eligible', type: 'boolean' }] },
    extract: [{ to: 'resources.eligible', from: 'response.data.eligible', required: true }],
  },
  {
    stepKey: 'first_screen.credit_products',
    workflowStepCode: 'lifecycle.credit_products',
    method: 'GET',
    path: customerPath('/credit-products'),
    actor: 'customer',
    // Dos lecturas independientes no pueden contradecirse.
    expect: { status: [200], assertions: [{ kind: 'sameAs', path: 'data.eligible', ref: 'resources.eligible' }] },
    branches: [
      {
        label: 'no elegible: debe explicar por qué',
        when: { kind: 'equals', path: 'resources.eligible', value: false },
        status: [200],
        assertions: [
          { kind: 'sameAs', path: 'data.eligible', ref: 'resources.eligible' },
          { kind: 'type', path: 'data.blockers', type: 'array' },
        ],
      },
    ],
  },
  {
    stepKey: 'first_screen.credit_applications',
    workflowStepCode: 'lifecycle.credit_applications',
    method: 'GET',
    path: customerPath('/credit-applications'),
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.applications', type: 'array' }] },
  },
  {
    stepKey: 'first_screen.unread_count',
    workflowStepCode: 'lifecycle.unread_count',
    method: 'GET',
    path: customerPath('/notifications/unread-count'),
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.unread', type: 'number' }] },
  },
  {
    stepKey: 'first_screen.token_refresh',
    method: 'POST',
    path: '/auth/refresh',
    actor: 'anonymous',
    body: { refreshToken: { $ref: 'session.customer.refreshToken' } },
    expect: { status: [200, 201], assertions: [{ kind: 'type', path: 'data.accessToken', type: 'string' }] },
    extract: [
      { to: 'session.customer.accessToken', from: 'response.data.accessToken', required: true },
      { to: 'session.customer.refreshToken', from: 'response.data.refreshToken' },
    ],
  },
  {
    // Tras el refresh la sesión sigue siendo de la misma persona.
    stepKey: 'first_screen.me_after_refresh',
    method: 'GET',
    path: '/auth/me',
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'resourceOwner', path: 'data.customerId', expected: { $ref: 'resources.customerId' } }] },
  },
];

const base = {
  workflowVersion: 'v1',
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'] as JourneyTemplate['datasetModes'],
};

export const ACCOUNT_SIGNUP_TO_LOGIN: JourneyTemplate = {
  ...base,
  code: 'account_signup_to_login',
  version: '1.0.0',
  name: 'Alta de cuenta hasta la sesión iniciada',
  description: 'Textos legales → alta → login → identidad. Cada persona crea su cliente y entra con su propia sesión.',
  workflowCode: 'customer_full_lifecycle',
  actors: ['anonymous', 'customer'],
  expectedTerminal: 'Sesión iniciada que pertenece al customerId que la persona creó.',
  status: 'READY',
  fixtures: ['consents'],
  steps: SIGNUP_STEPS,
};

export const POST_LOGIN_FIRST_SCREEN: JourneyTemplate = {
  ...base,
  code: 'post_login_first_screen',
  version: '1.0.0',
  name: 'Primera pantalla tras el login',
  description: 'Alta propia y, con esa sesión, perfil, estado, elegibilidad, productos, avisos y refresh coherentes entre sí.',
  workflowCode: 'customer_full_lifecycle',
  actors: ['anonymous', 'customer'],
  expectedTerminal: 'Lecturas de la primera pantalla coherentes y del cliente correcto; refresh sin cambio de identidad.',
  status: 'READY',
  fixtures: ['consents'],
  steps: [...SIGNUP_STEPS, ...FIRST_SCREEN_STEPS],
};
