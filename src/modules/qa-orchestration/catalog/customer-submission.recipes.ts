/**
 * @file Catálogo de recetas: el alta completa del cliente hasta que el expediente va a revisión.
 * @business Esta pieza prueba el tramo más largo y frágil del producto: verificar el contacto con el
 *   código que de verdad llega, subir el carnet y la selfie, pasar SEGIP y enviar a revisión.
 * @system sin atajos: el código se lee del buzón QA (el backend lo envía por su canal real en modo
 *   webhook) y las imágenes son bytes JPEG sintéticos subidos a la URL firmada del almacenamiento QA.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { SYNTHETIC_UPLOAD_BYTES } from '../fixtures/synthetic-upload.js';
import { SIGNUP_STEPS } from './customer-account.recipes.js';

const o = (suffix: string) => `/customer-onboarding/{{resources.customerId}}${suffix}`;
type Image = 'identity_front' | 'identity_back' | 'selfie';

/** Pedir URL firmada y subir bytes reales: dos pasos por imagen, el segundo depende del primero. */
function evidenceSteps(image: Image, workflowStepCode?: string): RecipeStep[] {
  return [
    {
      stepKey: `submission.upload_url_${image}`,
      workflowStepCode,
      method: 'POST',
      path: o('/documents/upload-url'),
      actor: 'customer',
      dependsOn: ['signup.me'],
      idempotency: 'per_operation',
      body: { documentType: image, contentType: 'image/jpeg', sizeBytes: SYNTHETIC_UPLOAD_BYTES },
      expect: { status: [200, 201], assertions: [{ kind: 'type', path: 'data.uploadUrl', type: 'string' }] },
      extract: [
        { to: `resources.${image}_url`, from: 'response.data.uploadUrl', required: true },
        { to: `resources.${image}_key`, from: 'response.data.storageKey', required: true },
      ],
    },
    {
      stepKey: `submission.upload_${image}`,
      method: 'PUT',
      path: '(almacenamiento QA)',
      actor: 'anonymous',
      dependsOn: [`submission.upload_url_${image}`],
      upload: { urlFrom: `resources.${image}_url`, image, extractSha256To: `resources.${image}_sha256` },
      expect: { status: [200] },
    },
  ];
}

const evidenceItem = (image: Image) => ({
  evidenceType: image,
  storageKey: { $ref: `resources.${image}_key` },
  mimeType: 'image/jpeg',
  sha256Hash: { $ref: `resources.${image}_sha256` },
});

const CONTACT: RecipeStep[] = [
  {
    stepKey: 'submission.contact_request',
    workflowStepCode: 'lifecycle.contact_request',
    method: 'POST',
    path: o('/contact-verification/request'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { contactType: 'email', verificationChannel: 'email' },
    expect: { status: [200, 202], assertions: [{ kind: 'equals', path: 'data.deliveredChannel', expected: 'email' }] },
  },
  {
    // El código que el backend acaba de enviar, leído del buzón QA: sin él no hay verificación.
    stepKey: 'submission.contact_code',
    method: 'GET',
    path: '(buzón QA)',
    actor: 'anonymous',
    otp: { channel: 'email', toFrom: 'persona.email', extractTo: 'session.otp.contact' },
    expect: { status: [200] },
  },
  {
    stepKey: 'submission.contact_submit',
    workflowStepCode: 'lifecycle.contact_submit',
    method: 'POST',
    path: o('/contact-verification/submit'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { contactType: 'email', verificationChannel: 'email', verificationCode: { $ref: 'session.otp.contact' } },
    expect: { status: [200, 201] },
  },
];

const IDENTITY: RecipeStep[] = [
  ...evidenceSteps('identity_front', 'lifecycle.documents_upload_url'),
  ...evidenceSteps('identity_back'),
  ...evidenceSteps('selfie'),
  {
    stepKey: 'submission.identity_package',
    workflowStepCode: 'lifecycle.identity_package',
    method: 'POST',
    path: o('/identity-package'),
    actor: 'customer',
    dependsOn: ['submission.upload_identity_front', 'submission.upload_identity_back', 'submission.upload_selfie'],
    idempotency: 'per_operation',
    body: {
      identity: {
        documentType: 'ci',
        documentNumberHash: { $ref: 'persona.documentNumberHash' },
        documentNumber: { $ref: 'persona.documentNumber' },
        documentLast4: { $ref: 'persona.documentLast4' },
        countryCode: 'BOL',
        expiresAt: '2031-12-31',
      },
      evidence: [evidenceItem('identity_front'), evidenceItem('identity_back'), evidenceItem('selfie')],
    },
    // El paquete verifica contra SEGIP en el acto (medido: `identity_verified_by_provider`). En
    // `happy_path` del mock el resultado es `verified`; lo que no puede pasar es que no llame.
    expect: {
      status: [200, 201, 202],
      assertions: [{ kind: 'oneOf', path: 'data.verification.identityVerificationResult', values: ['verified', 'pending_review'] }],
    },
    branches: [
      {
        label: 'SEGIP responde: identidad verificada por el proveedor',
        when: { kind: 'equals', path: 'run.scenarioCode', value: 'happy_path' },
        status: [200, 201, 202],
        assertions: [
          { kind: 'equals', path: 'data.verification.identityVerificationResult', expected: 'verified' },
          { kind: 'equals', path: 'data.verification.reasonCode', expected: 'identity_verified_by_provider' },
        ],
      },
    ],
    extract: [{ to: 'resources.identityResult', from: 'response.data.verification.identityVerificationResult', required: true }],
    providers: [{ provider: 'SEGIP', expectCall: 'required' }],
  },
  {
    // Sin este consentimiento la política corta la consulta a SEGIP (CONSENT_REQUIRED) y la
    // identidad no se puede verificar: es lo que la app pide antes del paso de identidad.
    stepKey: 'submission.external_consent',
    method: 'POST',
    path: '/external-data/consents',
    actor: 'customer',
    dependsOn: ['signup.me'],
    idempotency: 'per_operation',
    body: { customerId: { $ref: 'resources.customerId' }, providerCode: 'SEGIP', purpose: 'identity_verification', accepted: true },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'submission.identity_verification',
    workflowStepCode: 'lifecycle.identity_verification',
    method: 'POST',
    path: o('/identity-verification'),
    actor: 'customer',
    dependsOn: ['submission.identity_package', 'submission.external_consent'],
    idempotency: 'per_operation',
    body: { documentNumber: { $ref: 'persona.documentNumber' } },
    expect: { status: [200, 201, 202] },
    branches: [
      {
        // Una identidad ya verificada no se vuelve a verificar: el rechazo exacto es el éxito.
        label: 'ya verificada: se rechaza la reverificación',
        when: { kind: 'equals', path: 'resources.identityResult', value: 'verified' },
        status: [422],
        assertions: [{ kind: 'equals', path: 'error.message', expected: 'IDENTITY_ALREADY_VERIFIED' }],
      },
    ],
    providers: [{ provider: 'SEGIP', expectCall: 'cache_or_call' }],
  },
];

const DOSSIER: RecipeStep[] = [
  {
    stepKey: 'submission.address_package',
    method: 'POST',
    path: o('/address-package'),
    actor: 'customer',
    dependsOn: ['signup.me'],
    idempotency: 'per_operation',
    body: {
      address: {
        countryCode: 'BOL',
        department: { $ref: 'persona.department' },
        city: { $ref: 'persona.city' },
        zone: 'Centro',
        addressLine: 'Calle QA 123',
      },
    },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'submission.financial_profile',
    method: 'PUT',
    path: o('/financial-profile'),
    actor: 'customer',
    dependsOn: ['signup.me'],
    idempotency: 'per_operation',
    body: {
      employmentStatus: 'employee',
      employerName: 'Empresa Sintética QA',
      employmentSeniorityMonths: 24,
      monthlyIncomeDeclared: { $ref: 'persona.monthlyIncome' },
      monthlyExpensesDeclared: 1500,
      economicActivityCode: 'comercio_minorista',
      sourceOfFunds: 'salary',
    },
    expect: { status: [200] },
  },
  {
    stepKey: 'submission.reference_contacts',
    method: 'POST',
    path: o('/reference-contacts'),
    actor: 'customer',
    dependsOn: ['signup.me'],
    idempotency: 'per_operation',
    body: {
      references: [
        { relationshipType: 'family', fullName: 'Rosa Mamani Sintética', phone: '70012345', consentBasis: 'customer_declared' },
        { relationshipType: 'coworker', fullName: 'Jorge Rojas Sintético', phone: '70054321', consentBasis: 'customer_declared' },
      ],
    },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'submission.survey',
    method: 'PUT',
    path: o('/consumer-survey'),
    actor: 'customer',
    dependsOn: ['signup.me'],
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
];

const SUBMIT: RecipeStep[] = [
  {
    stepKey: 'submission.submit',
    workflowStepCode: 'lifecycle.submit',
    method: 'POST',
    path: o('/submit'),
    actor: 'customer',
    dependsOn: [
      'submission.contact_submit',
      'submission.identity_verification',
      'submission.address_package',
      'submission.financial_profile',
      'submission.reference_contacts',
      'submission.survey',
    ],
    idempotency: 'per_operation',
    body: { acknowledgement: true },
    expect: { status: [200, 201, 202] },
  },
  {
    stepKey: 'submission.status_after_submit',
    method: 'GET',
    path: o('/status'),
    actor: 'customer',
    dependsOn: ['submission.submit'],
    expect: { status: [200], assertions: [{ kind: 'type', path: 'data.lifecycleStatus', type: 'string' }] },
    extract: [{ to: 'resources.lifecycleAfterSubmit', from: 'response.data.lifecycleStatus' }],
  },
];

export const CUSTOMER_ONBOARDING_SUBMISSION: JourneyTemplate = {
  code: 'customer_onboarding_submission',
  version: '1.0.0',
  name: 'Alta completa hasta revisión',
  description:
    'Alta propia, verificación del correo con el código real (buzón QA), carnet y selfie subidos, paquete de identidad, ' +
    'SEGIP por el mock, domicilio, perfil financiero, referencias, encuesta y envío a revisión.',
  workflowCode: 'customer_full_lifecycle',
  workflowVersion: 'v1',
  actors: ['anonymous', 'customer'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal: 'Expediente enviado a revisión con contacto verificado, identidad presentada y todos los bloques completos.',
  status: 'READY',
  fixtures: ['consents'],
  steps: [...SIGNUP_STEPS, ...CONTACT, ...IDENTITY, ...DOSSIER, ...SUBMIT],
};
