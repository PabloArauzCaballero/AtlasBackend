/**
 * @file Reglas puras: qué se puede pedir corregir y cómo se clasifica cada campo.
 * @business Una corrección sin campo ni valor no se puede decidir: ni una persona ni el Motor saben qué aceptar. Este vocabulario cerrado es lo que la vuelve decidible.
 * @system sin dependencias; lo usan el esquema de entrada, la cola de operaciones y (F1) las variables del Motor.
 */

/**
 * Los campos que una persona puede pedir corregir. `other` existe para no obligar a mentir: lo que no está en la lista
 * se pide igual y lo mira una persona.
 */
export const RECTIFICATION_FIELDS = [
  'address',
  'zone',
  'city',
  'address_reference',
  'occupation',
  'employer',
  'declared_income',
  'first_name',
  'last_name',
  'birth_date',
  'document_number',
  'phone',
  'email',
  'other',
] as const;
export type RectificationField = (typeof RECTIFICATION_FIELDS)[number];

/**
 * Cambiar estos es cambiar QUIÉN es la persona ante Atlas: exige actualizar la diligencia debida (DS 4904, art. 18), con
 * documento y una persona que lo revise. Nunca se aceptan en automático.
 */
export const IDENTITY_FIELDS: ReadonlySet<RectificationField> = new Set(['first_name', 'last_name', 'birth_date', 'document_number']);

/** Cambiarlos puede mover la línea de crédito: aceptarlos sin mirar es un atajo para subirla. */
export const CREDIT_FIELDS: ReadonlySet<RectificationField> = new Set(['declared_income', 'occupation', 'employer']);

/** Tienen su propio camino seguro (código al contacto nuevo): por una solicitud se saltaría esa verificación. */
export const CONTACT_FIELDS: ReadonlySet<RectificationField> = new Set(['phone', 'email']);

/** Hasta cuándo vale una confirmación de PIN para pedir algo sobre la cuenta. */
export const PIN_STEP_UP_WINDOW_MS = 5 * 60_000;
