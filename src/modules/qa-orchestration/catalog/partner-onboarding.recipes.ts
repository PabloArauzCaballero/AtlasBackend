/**
 * @file Catálogo de recetas: el alta completa de un comercio, de la provisión al comercio operativo.
 * @business Esta pieza prueba el lado del comercio: el operador provisiona al usuario, el comercio
 *   entra con su contraseña temporal, completa su expediente (representante, registro, perfil,
 *   contacto verificado, sucursal, caja, poder y QR subidos) y el operador lo revisa y aprueba.
 * @system cada persona es un comercio con SU usuario; la contraseña temporal y la sesión de comercio
 *   van sólo a `session.*`. El código de contacto se lee del buzón QA y los archivos son bytes reales.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { PARTNER_DOSSIER_STEPS } from './partner-dossier.recipes.js';

const p = (suffix: string) => `/partner-onboarding/{{resources.partnerId}}${suffix}`;
const opsP = (suffix: string) => `/operations/partners/{{resources.partnerId}}${suffix}`;

export const MERCHANT_PROVISIONING_STEPS: RecipeStep[] = [
  {
    stepKey: 'merchant.provisioning_request',
    workflowStepCode: 'merchant.provisioning_request',
    method: 'POST',
    path: '/merchant/users/provisioning-requests',
    actor: 'internal_user',
    dependsOn: [],
    body: {
      externalReference: 'qa-{{run.nonce}}-{{persona.personaKey}}',
      email: { $ref: 'persona.email' },
      fullName: '{{persona.firstName}} {{persona.lastName}} (comercio sintético)',
    },
    expect: { status: [200, 201], assertions: [{ kind: 'equals', path: 'data.status', expected: 'pending' }] },
    extract: [{ to: 'resources.provisioningRequestId', from: 'response.data.id', required: true }],
  },
  {
    stepKey: 'merchant.provisioning_list',
    workflowStepCode: 'merchant.provisioning_list',
    method: 'GET',
    path: '/merchant/users/provisioning-requests',
    query: { status: 'pending', email: { $ref: 'persona.email' } },
    actor: 'internal_user',
    expect: {
      status: [200],
      assertions: [{ kind: 'arrayContainsWhere', path: 'data.items', field: 'id', expected: { $ref: 'resources.provisioningRequestId' } }],
    },
  },
  {
    // La contraseña temporal sale UNA vez, aquí: va a la sesión del comercio y nunca a la evidencia.
    stepKey: 'merchant.provisioning_approve',
    workflowStepCode: 'merchant.provisioning_approve',
    method: 'POST',
    path: '/merchant/users/provisioning-requests/{{resources.provisioningRequestId}}/approve',
    actor: 'internal_user',
    body: {},
    expect: { status: [200, 201], assertions: [{ kind: 'equals', path: 'data.request.status', expected: 'provisioned' }] },
    extract: [
      { to: 'session.merchant_user.password', from: 'response.data.temporaryPassword', required: true },
      { to: 'resources.merchantUserId', from: 'response.data.merchantUser.id', required: true },
    ],
  },
  {
    stepKey: 'merchant.login',
    workflowStepCode: 'merchant.login',
    method: 'POST',
    path: '/merchant/auth/login',
    actor: 'anonymous',
    rateLimit: { bucket: 'merchant_login', perMinute: 10 },
    body: { tenantId: '1', email: { $ref: 'persona.email' }, password: { $ref: 'session.merchant_user.password' } },
    expect: { status: [200, 201], assertions: [{ kind: 'equals', path: 'data.user.role', expected: 'merchant' }] },
    extract: [{ to: 'session.merchant_user.accessToken', from: 'cookies.atlas_internal_access', required: true }],
  },
  {
    stepKey: 'merchant.me',
    workflowStepCode: 'merchant.me',
    method: 'GET',
    path: '/merchant/auth/me',
    actor: 'merchant_user',
    expect: { status: [200], assertions: [{ kind: 'resourceOwner', path: 'data.id', expected: { $ref: 'resources.merchantUserId' } }] },
  },
];

const REVIEW: RecipeStep[] = [
  {
    stepKey: 'partner.submit',
    workflowStepCode: 'partner.submit',
    method: 'POST',
    path: p('/submit'),
    actor: 'merchant_user',
    dependsOn: [
      'partner.contact_submit',
      'partner.legal_representative',
      'partner.commercial_registry',
      'partner.qr_create',
      'partner.bank_qr_create',
      'partner.pos_update',
    ],
    idempotency: 'per_operation',
    body: {},
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'partner.status',
    workflowStepCode: 'partner.status',
    method: 'GET',
    path: p('/status'),
    actor: 'merchant_user',
    expect: { status: [200] },
  },
  {
    stepKey: 'partner.queue',
    workflowStepCode: 'partner.queue',
    method: 'GET',
    path: '/operations/partners/queue',
    actor: 'internal_user',
    dependsOn: ['partner.submit'],
    expect: { status: [200] },
  },
  {
    stepKey: 'partner.kyb_review',
    workflowStepCode: 'partner.kyb_review',
    method: 'POST',
    path: opsP('/kyb-review'),
    actor: 'internal_user',
    dependsOn: ['partner.submit'],
    idempotency: 'per_operation',
    body: { reason: 'Revisión KYB de comercio sintético QA' },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'partner.qr_pending',
    workflowStepCode: 'partner.qr_pending',
    method: 'GET',
    path: '/operations/partners/qr-codes/pending',
    actor: 'internal_user',
    dependsOn: ['partner.submit'],
    expect: { status: [200] },
  },
  {
    stepKey: 'partner.qr_review',
    workflowStepCode: 'partner.qr_review',
    method: 'POST',
    path: opsP('/qr-codes/{{resources.qrId}}/review'),
    actor: 'internal_user',
    dependsOn: ['partner.submit'],
    idempotency: 'per_operation',
    body: { approved: true, note: 'QR sintético revisado en QA' },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'partner.bank_qr_review',
    method: 'POST',
    path: opsP('/qr-codes/{{resources.bankQrId}}/review'),
    actor: 'internal_user',
    dependsOn: ['partner.submit'],
    idempotency: 'per_operation',
    body: { approved: true, note: 'QR bancario sintético revisado en QA' },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'partner.decision',
    workflowStepCode: 'partner.decision',
    method: 'POST',
    path: opsP('/decision'),
    actor: 'internal_user',
    dependsOn: ['partner.kyb_review', 'partner.qr_review', 'partner.bank_qr_review'],
    idempotency: 'per_operation',
    body: { approved: true },
    expect: { status: [200, 201] },
  },
  {
    stepKey: 'partner.erp_account',
    workflowStepCode: 'partner.erp_account',
    method: 'PATCH',
    path: opsP('/erp-account'),
    actor: 'internal_user',
    dependsOn: ['partner.decision'],
    idempotency: 'per_operation',
    body: { erpAccountId: 'ERP-QA-{{run.nonce}}-{{persona.personaKey}}' },
    expect: { status: [200] },
  },
  {
    stepKey: 'partner.qr_content',
    workflowStepCode: 'partner.qr_content',
    method: 'GET',
    path: p('/qr-codes/{{resources.qrId}}/content'),
    actor: 'merchant_user',
    dependsOn: ['partner.qr_review'],
    expect: { status: [200] },
  },
  {
    stepKey: 'merchant.users',
    workflowStepCode: 'merchant.users',
    method: 'GET',
    path: '/merchant/users',
    actor: 'internal_user',
    dependsOn: ['merchant.provisioning_approve'],
    expect: { status: [200] },
  },
];

export const PARTNER_FULL_ONBOARDING: JourneyTemplate = {
  code: 'partner_full_onboarding',
  version: '1.0.0',
  name: 'Alta completa de un comercio',
  description:
    'El operador provisiona al usuario de comercio; el comercio entra, completa su expediente (representante, registro, ' +
    'contacto verificado, sucursal, caja, poder y QR subidos) y lo envía; el operador revisa KYB y QR y lo aprueba.',
  workflowCode: 'customer_partner_commerce',
  workflowVersion: 'v1',
  actors: ['anonymous', 'internal_user', 'merchant_user'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal:
    'Comercio aprobado con sucursal, caja activa, QR revisado y cuenta ERP enlazada; su usuario opera con su propia sesión.',
  status: 'READY',
  fixtures: ['internalActor'],
  // El envío del expediente lo verifica el Motor; sin Motor el alta no pasa de «borrador».
  platformServices: ['DECISION_ENGINE'],
  steps: [...MERCHANT_PROVISIONING_STEPS, ...PARTNER_DOSSIER_STEPS, ...REVIEW],
};
