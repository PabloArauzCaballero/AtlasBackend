/**
 * @file Catálogo de recetas: los canales del dispositivo del cliente — WhatsApp y la agenda.
 * @business Esta pieza prueba dos promesas de la app: que el número de WhatsApp se verifica contra el
 *   proveedor de contactabilidad, y que la agenda que el cliente decide compartir se guarda.
 * @system la verificación de WhatsApp es una consulta al proveedor de contactabilidad (en QA, el mock,
 *   con su journal); hoy no envía código (ver el hallazgo abajo). La agenda exige el consentimiento `device_address_book`
 *   —que el alta concede— y un dispositivo vinculado a la persona.
 */
import type { JourneyTemplate, RecipeStep } from '../domain/journey-recipe.types.js';
import { SIGNUP_STEPS } from './customer-account.recipes.js';

export const CUSTOMER_CHANNEL_STEPS: RecipeStep[] = [
  {
    stepKey: 'channels.address_book',
    workflowStepCode: 'lifecycle.address_book',
    method: 'POST',
    path: '/customers/{{resources.customerId}}/address-book',
    actor: 'customer',
    dependsOn: ['signup.me'],
    idempotency: 'per_operation',
    body: {
      deviceId: { $ref: 'resources.deviceId' },
      sessionId: { $ref: 'resources.sessionId' },
      algorithmVersion: 'qa-agenda@1',
      capturedAt: { $ref: 'run.nowIso' },
      isFinalBatch: true,
      totalContactsInDevice: 2,
      contacts: [
        {
          externalId: 'qa-{{persona.personaKey}}-1',
          displayName: 'Contacto Sintético Uno',
          phones: [{ label: 'móvil', number: '70011111' }],
        },
        {
          externalId: 'qa-{{persona.personaKey}}-2',
          displayName: 'Contacto Sintético Dos',
          phones: [{ label: 'móvil', number: '70022222' }],
        },
      ],
    },
    expect: {
      status: [200, 201, 202],
      assertions: [
        { kind: 'equals', path: 'data.received', expected: 2 },
        { kind: 'resourceOwner', path: 'data.customerId', expected: { $ref: 'resources.customerId' } },
      ],
    },
  },
];

const WHATSAPP_STEPS: RecipeStep[] = [
  {
    stepKey: 'channels.whatsapp_consent',
    method: 'POST',
    path: '/external-data/consents',
    actor: 'customer',
    dependsOn: ['signup.me'],
    idempotency: 'per_operation',
    body: { customerId: { $ref: 'resources.customerId' }, providerCode: 'WHATSAPP_GENERIC', purpose: 'contactability', accepted: true },
    expect: { status: [200, 201] },
  },
  /*
   * HALLAZGO (2026-09-24): hoy «verificar WhatsApp» NO envía ningún código. `start` y `confirm`
   * son la misma consulta al proveedor de contactabilidad, y su emulador da `OTP_VERIFIED` a
   * cualquier código. Peor: `confirm` sale de la caché de la consulta de `start` sin llamar al
   * proveedor, así que el código que se escriba no se mira nunca. Esta receta afirma lo que el backend hace —la consulta llega al proveedor y
   * vuelve verificada— y no finge leer un código que nadie manda. Cuando exista el envío real, el
   * paso de buzón (canal `whatsapp`) va entre los dos.
   */
  {
    stepKey: 'channels.whatsapp_start',
    workflowStepCode: 'lifecycle.whatsapp_start',
    method: 'POST',
    path: '/whatsapp/verification/start',
    actor: 'customer',
    dependsOn: ['channels.whatsapp_consent'],
    idempotency: 'per_operation',
    body: { customerId: { $ref: 'resources.customerId' }, phoneNumber: { $ref: 'persona.phone' } },
    expect: {
      status: [200, 201, 202],
      assertions: [
        { kind: 'equals', path: 'data.reasonCode', expected: 'OTP_VERIFIED' },
        { kind: 'equals', path: 'data.modeUsed', expected: 'mock_server' },
        { kind: 'arrayContainsWhere', path: 'data.observations', field: 'featureKey', expected: 'whatsapp_otp_verified' },
      ],
    },
    providers: [{ provider: 'WHATSAPP_GENERIC', expectCall: 'required' }],
  },
  {
    stepKey: 'channels.whatsapp_confirm',
    workflowStepCode: 'lifecycle.whatsapp_confirm',
    method: 'POST',
    path: '/whatsapp/verification/confirm',
    actor: 'customer',
    idempotency: 'per_operation',
    body: { customerId: { $ref: 'resources.customerId' }, phoneNumber: { $ref: 'persona.phone' }, otpCode: '000000' },
    expect: {
      status: [200, 201],
      assertions: [
        { kind: 'equals', path: 'data.reasonCode', expected: 'OTP_VERIFIED' },
        { kind: 'equals', path: 'data.modeUsed', expected: 'mock_server' },
        { kind: 'arrayContainsWhere', path: 'data.observations', field: 'featureKey', expected: 'whatsapp_otp_verified' },
      ],
    },
    providers: [{ provider: 'WHATSAPP_GENERIC', expectCall: 'cache_or_call' }],
  },
];

export const CUSTOMER_WHATSAPP_VERIFICATION: JourneyTemplate = {
  code: 'customer_whatsapp_verification',
  version: '1.0.0',
  name: 'Verificación de WhatsApp',
  description:
    'Alta propia, consentimiento de contactabilidad y verificación del número de WhatsApp (inicio y confirmación) ' +
    'contra el proveedor, con su llamada comprobada en el journal del mock.',
  workflowCode: 'customer_full_lifecycle',
  workflowVersion: 'v1',
  actors: ['anonymous', 'customer'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal: 'Número de WhatsApp verificado por el proveedor de contactabilidad.',
  status: 'READY',
  fixtures: ['consents'],
  steps: [...SIGNUP_STEPS, ...WHATSAPP_STEPS],
};
