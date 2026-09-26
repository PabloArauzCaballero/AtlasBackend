/**
 * @file Catálogo de recetas: sesión, contacto y expediente del cliente (parte de su perfil).
 * @business Esta pieza prueba la sesión de app, el contacto, el domicilio, la ubicación, el perfil
 *   financiero y las referencias de una persona sintética, cada una del cliente correcto.
 * @system bloques usados por `customer-profile.recipes.ts`; cuerpos tomados de los Zod publicados.
 */
import type { RecipeStep } from '../domain/journey-recipe.types.js';

const c = (suffix: string) => `/customers/{{resources.customerId}}${suffix}`;
const o = (suffix: string) => `/customer-onboarding/{{resources.customerId}}${suffix}`;
const own = { kind: 'resourceOwner' as const, path: 'data.customerId', expected: { $ref: 'resources.customerId' } };

export const PROFILE_SESSION_AND_CONTACT: RecipeStep[] = [
  {
    stepKey: 'profile.verification_channels',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.verification_channels',
    method: 'GET',
    path: '/customer-onboarding/verification-channels',
    actor: 'customer',
    expect: { status: [200], assertions: [{ kind: 'arrayNonEmpty', path: 'data.channels' }] },
  },
  {
    stepKey: 'profile.survey_catalog',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.survey_catalog',
    method: 'GET',
    path: '/customer-onboarding/consumer-survey/catalog',
    actor: 'customer',
    expect: {
      status: [200],
      assertions: [
        { kind: 'equals', path: 'data.surveyVersion', expected: 'habitos-v1' },
        { kind: 'arrayLength', path: 'data.questions', equals: 6 },
      ],
    },
  },
  {
    stepKey: 'profile.session_start',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.session_start',
    method: 'POST',
    path: c('/sessions/start'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { device: { deviceFingerprintHash: { $ref: 'persona.deviceFingerprintHash' }, fingerprintVersion: 'v1', channel: 'mobile_app' } },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'profile.contact_methods',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.contact_methods',
    method: 'POST',
    path: o('/contact-methods'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { contactType: 'email', value: 'qa.alt.{{persona.personaKey}}.{{run.nonce}}@example.test', label: 'trabajo' },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'profile.contact_request',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.contact_request',
    method: 'POST',
    path: o('/contact-verification/request'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { contactType: 'email', verificationChannel: 'email' },
    expect: { status: [200, 202] },
  },
];

export const PROFILE_DOSSIER: RecipeStep[] = [
  {
    stepKey: 'profile.address_package',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.address_package',
    method: 'POST',
    path: o('/address-package'),
    actor: 'customer',
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
    stepKey: 'profile.location_pings',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.location_pings',
    method: 'POST',
    path: c('/location-pings'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: {
      deviceId: { $ref: 'resources.deviceId' },
      sessionId: { $ref: 'resources.sessionId' },
      pings: [{ lat: -16.5, lng: -68.15, accuracyMeters: 15, capturedAt: { $ref: 'run.nowIso' } }],
    },
    expect: { status: [200, 202] },
  },
  {
    stepKey: 'profile.financial_profile',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.financial_profile',
    method: 'PUT',
    path: o('/financial-profile'),
    actor: 'customer',
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
    stepKey: 'profile.reference_contacts_add',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.reference_contacts_add',
    method: 'POST',
    path: o('/reference-contacts'),
    actor: 'customer',
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
    // Efecto de la escritura anterior: la referencia aparece, y en el expediente de ESTE cliente.
    stepKey: 'profile.reference_contacts_list',
    dependsOn: ['profile.reference_contacts_add'],
    workflowStepCode: 'lifecycle.reference_contacts_list',
    method: 'GET',
    path: o('/reference-contacts'),
    actor: 'customer',
    expect: { status: [200], assertions: [own, { kind: 'arrayLength', path: 'data.references', min: 1 }] },
  },
  {
    stepKey: 'profile.contacts_snapshot',
    dependsOn: ['signup.me'],
    workflowStepCode: 'lifecycle.contacts_snapshot',
    method: 'POST',
    path: o('/contacts-snapshot'),
    actor: 'customer',
    idempotency: 'per_operation',
    body: { granted: false, algorithmVersion: 'qa-v1', computedAt: { $ref: 'run.nowIso' } },
    expect: { status: [200, 202] },
  },
];
