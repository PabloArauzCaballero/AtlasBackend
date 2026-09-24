/**
 * @file Catálogo de recetas: evidencia externa, solicitud de crédito y casos negativos del cliente.
 * @business Esta pieza prueba que Atlas llama al proveedor sólo cuando corresponde, que una persona
 *   no elegible es RECHAZADA (y que ese rechazo es el éxito de la prueba) y que un alta incompleta
 *   no crea nada.
 * @system recetas declarativas; el oráculo de proveedor se contrasta contra el journal del mock.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { SIGNUP_STEPS } from './customer-account.recipes.js';

const segipBody = {
  customerId: { $ref: 'resources.customerId' },
  providerCode: 'SEGIP',
  queryType: 'IDENTITY_VERIFICATION',
  purpose: 'identity_verification',
  decisionStage: 'onboarding',
  input: { documentNumber: { $ref: 'persona.documentNumber' } },
};

export const CREDIT_STEPS: RecipeStep[] = [
  {
    // Sin consentimiento la política bloquea la consulta y el proveedor no recibe nada.
    stepKey: 'credit.external_consent',
    workflowStepCode: 'lifecycle.external_consent',
    method: 'POST',
    path: '/external-data/consents',
    actor: 'customer',
    body: { customerId: { $ref: 'resources.customerId' }, providerCode: 'SEGIP', purpose: 'identity_verification', accepted: true },
    expect: { status: [200, 201] },
  },
  {
    // La previa de costo NO puede ejecutar al proveedor: se exige cero llamadas en el journal.
    stepKey: 'credit.external_preview',
    workflowStepCode: 'lifecycle.external_preview',
    method: 'POST',
    path: '/external-data/requests/preview',
    actor: 'customer',
    body: segipBody,
    expect: { status: [200, 201] },
    providers: [{ provider: 'SEGIP', expectCall: 'none' }],
  },
  {
    stepKey: 'credit.external_request',
    workflowStepCode: 'lifecycle.external_request',
    method: 'POST',
    path: '/external-data/requests',
    actor: 'customer',
    idempotency: 'per_operation',
    body: segipBody,
    // El desenlace del proveedor depende del escenario de la corrida, y se exige el que corresponde:
    // un `provider_down` que devolviera «FOUND» sería el falso positivo que esta receta existe para
    // atrapar. Valores medidos contra el mock real (corridas 6, 7 y 8 del 24-sep-2026).
    expect: {
      status: [200, 201],
      assertions: [
        { kind: 'equals', path: 'data.status', expected: 'MOCKED' },
        { kind: 'equals', path: 'data.providerVerdict', expected: 'FOUND' },
        { kind: 'equals', path: 'data.modeUsed', expected: 'mock_server' },
      ],
    },
    branches: [
      {
        label: 'proveedor caído: indisponible y a revisión manual',
        when: { kind: 'equals', path: 'run.scenarioCode', value: 'provider_down' },
        status: [200, 201],
        assertions: [
          { kind: 'equals', path: 'data.status', expected: 'PROVIDER_UNAVAILABLE' },
          { kind: 'equals', path: 'data.manualReviewRequired', expected: true },
        ],
      },
      {
        label: 'proveedor sin respuesta: fallo con revisión manual, sin veredicto inventado',
        when: { kind: 'equals', path: 'run.scenarioCode', value: 'timeout' },
        status: [200, 201],
        assertions: [
          { kind: 'equals', path: 'data.status', expected: 'FAILED' },
          { kind: 'equals', path: 'data.manualReviewRequired', expected: true },
          { kind: 'absent', path: 'data.providerVerdict' },
        ],
      },
    ],
    extract: [
      { to: 'resources.externalRequestId', from: 'response.data.requestId' },
      { to: 'resources.externalModeUsed', from: 'response.data.modeUsed' },
    ],
    providers: [{ provider: 'SEGIP', expectCall: 'cache_or_call' }],
  },
  {
    stepKey: 'credit.external_observations',
    workflowStepCode: 'lifecycle.external_observations',
    method: 'GET',
    path: '/external-data/users/{{resources.customerId}}/observations',
    actor: 'customer',
    expect: { status: [200] },
  },
  {
    stepKey: 'credit.status',
    workflowStepCode: 'lifecycle.status',
    method: 'GET',
    path: '/customer-onboarding/{{resources.customerId}}/status',
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.lifecycleStatus', type: 'string' }] },
  },
  {
    stepKey: 'credit.products',
    workflowStepCode: 'lifecycle.credit_products',
    method: 'GET',
    path: '/customers/{{resources.customerId}}/credit-products',
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.eligible', type: 'boolean' }] },
    extract: [
      { to: 'resources.eligible', from: 'response.data.eligible', required: true },
      { to: 'resources.offeredProductId', from: 'response.data.products[0].id' },
    ],
  },
  {
    /*
     * El oráculo es CONDICIONAL. Una persona recién registrada no es elegible: el backend tiene que
     * rechazarla, y ese rechazo es el ÉXITO. Sólo cuando el catálogo declaró `eligible: true` y
     * ofreció un producto se exige que la solicitud se cree. El producto sale del catálogo por
     * código natural (fixture), nunca de un `"1"` quemado.
     */
    stepKey: 'credit.apply',
    workflowStepCode: 'lifecycle.credit_apply',
    method: 'POST',
    path: '/customers/{{resources.customerId}}/credit-applications',
    actor: 'customer',
    idempotency: 'per_operation',
    body: {
      productId: { $ref: 'fixtures.creditProductId' },
      requestedAmount: { $ref: 'persona.requestedAmount' },
      requestedTermMonths: 12,
      purposeCode: 'consumo',
    },
    expect: { status: [400, 403, 409, 422] },
    branches: [
      {
        label: 'elegible: la solicitud se crea',
        when: { kind: 'equals', path: 'resources.eligible', value: true },
        status: [200, 201],
        assertions: [{ kind: 'exists', path: 'data.applicationId' }],
      },
    ],
    extract: [{ to: 'resources.applicationId', from: 'response.data.applicationId' }],
  },
  {
    // Verificación del EFECTO: lo persistido coincide con lo que el paso anterior afirmó.
    stepKey: 'credit.verify_effect',
    workflowStepCode: 'lifecycle.credit_applications',
    method: 'GET',
    path: '/customers/{{resources.customerId}}/credit-applications',
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'arrayLength', path: 'data.applications', equals: 0 }] },
    branches: [
      {
        label: 'solicitud creada: debe aparecer persistida',
        when: { kind: 'exists', path: 'resources.applicationId' },
        status: [200],
        assertions: [{ kind: 'arrayContainsWhere', path: 'data.applications', field: 'id', expected: { $ref: 'resources.applicationId' } }],
      },
    ],
  },
];

export const CUSTOMER_CREDIT_JOURNEY: JourneyTemplate = {
  code: 'customer_credit_decision',
  // 1.1.0: el desenlace del proveedor se exige por escenario (1.0.0 aceptaba cualquier estado).
  version: '1.1.0',
  name: 'Del alta a la decisión de crédito',
  description:
    'Alta propia, consentimiento, previa sin llamada al proveedor, consulta SEGIP por el mock, elegibilidad y solicitud: ' +
    'si no es elegible, el rechazo es el resultado esperado.',
  workflowCode: 'customer_full_lifecycle',
  workflowVersion: 'v1',
  actors: ['anonymous', 'customer'],
  scenarios: ['happy_path', 'provider_down', 'timeout'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal:
    'Solicitud creada y persistida si era elegible; rechazo sin solicitud si no lo era. Proveedor llamado sólo en la consulta real.',
  status: 'READY',
  fixtures: ['consents', 'creditProduct'],
  steps: [...SIGNUP_STEPS, ...CREDIT_STEPS],
};

/**
 * Alta incompleta: falta el bloque de consentimientos. El error EXACTO es el éxito, y además no
 * puede existir cliente: el login posterior con esas credenciales tiene que fallar.
 */
export const CUSTOMER_ONBOARDING_INCOMPLETE: JourneyTemplate = {
  code: 'customer_onboarding_incomplete',
  version: '1.0.0',
  name: 'Alta incompleta rechazada',
  description: 'Se omite un requisito conocido del alta (consentimientos). Se espera el rechazo exacto y que no quede cliente creado.',
  workflowCode: 'customer_full_lifecycle',
  workflowVersion: 'v1',
  actors: ['anonymous'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['INVALID'],
  expectedTerminal: 'HTTP 400 VALIDATION_ERROR en el alta y login imposible con esas credenciales.',
  status: 'READY',
  fixtures: [],
  steps: [
    {
      stepKey: 'invalid.signup_without_consents',
      workflowStepCode: 'lifecycle.signup',
      method: 'POST',
      path: '/customer-onboarding/start',
      actor: 'anonymous',
      dependsOn: [],
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
        device: { deviceFingerprintHash: { $ref: 'persona.deviceFingerprintHash' }, fingerprintVersion: 'v1', channel: 'mobile_app' },
      },
      expect: { status: [400], assertions: [{ kind: 'errorCode', code: 'VALIDATION_ERROR' }] },
    },
    {
      stepKey: 'invalid.login_must_fail',
      workflowStepCode: 'lifecycle.login',
      method: 'POST',
      path: '/auth/login',
      actor: 'anonymous',
      rateLimit: { bucket: 'auth_login', perMinute: 10 },
      body: { actorType: 'customer', identifier: { $ref: 'persona.email' }, password: { $ref: 'persona.pin' } },
      expect: { status: [401] },
    },
  ],
};
